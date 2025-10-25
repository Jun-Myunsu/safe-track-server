// @ts-nocheck
// eslint-disable-next-line
/* eslint-env node */
const OpenAI = require("openai");

/**
 * AI 기반 위험 지역 예측 서비스 (강화 버전, 하향 보정/캘리브레이션 포함)
 * - 정밀 프롬프트/스키마 통합
 * - JSON 응답 강제(response_format)
 * - 신스키마 → 레거시 포맷 자동 변환(하위 호환)
 * - 점수→레벨 강제 재산출, 불확실성/안전시그널 하향 캡
 * - 색상/반경을 레벨과 절대 동기화
 */
class DangerPredictionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // 레벨-색상/반경 매핑(스키마 기본값)
    this.levelStyle = {
      LOW: { color: "#2ecc71", radius: 60 },
      MEDIUM: { color: "#f1c40f", radius: 80 },
      HIGH: { color: "#e67e22", radius: 100 },
      CRITICAL: { color: "#e74c3c", radius: 120 },
    };

    // ======== 프롬프트: 시스템 ========
    this.SYSTEM_PROMPT = `
당신은 "위치 안전 어시스턴트"입니다. 당신의 임무는 주어진 위치와 맥락 데이터를 바탕으로
해당 지점(또는 경로)의 현재 위험도를 정량·정성적으로 평가하고, 지도를 위한 시각화 정보와
행동 권고를 편향 없이 생성하는 것입니다.

핵심 원칙
- 환경·맥락 기반: 조명, 유동인구, 교통량, 시간대, 영업 중 시설, CCTV/가로등 밀도, 날씨, 이벤트,
  신고/사고 이력(개인/집단 특성 제외), 지형(골목/공터/하천변) 등 환경 요인만 고려합니다.
- 금지: 인종/성별/국적/복장/사회경제적 지위 등 개인 특성 추정·일반화·프로파일링 금지.
- 투명성: 사용한 근거를 요인별로 설명하고, 데이터가 부족하면 "불확실성"을 올려서 보고합니다.
- 실시간성: "지금 시간과 조건" 중심으로 평가하되, 과거 데이터는 보정적으로만 사용합니다.
- 보수성: 의심 구간은 낮은 확신으로 표시하고, 행동 권고는 과도하지 않되 즉시 실행 가능해야 합니다.

리스크 등급 캘리브레이션(기본)
- 0–24: LOW   (지도 색상: #2ecc71, 반경: 60 m)
- 25–49: MEDIUM (지도 색상: #f1c40f, 반경: 80 m)
- 50–74: HIGH  (지도 색상: #e67e22, 반경: 100 m)
- 75–100: CRITICAL (지도 색상: #e74c3c, 반경: 120 m)

불확실성 처리
- 핵심 입력(시간/날씨/조도/군중/교통/시설/사고 이력)이 결핍되면 confidence를 낮추고 data_gaps에 결핍 항목을 구체적으로 명시합니다.
- 데이터 공백을 임의 추정하지 말고, 의견 대신 조건부 권고로 대체합니다.

지도로의 매핑
- 현재 지점 표시는 marker.icon, marker.color, radius_m로 제공합니다.
- 열지도/버퍼 표현을 위해 heat.contributors 배열(요인별 가중·근거)을 제공합니다.
- heat.contributors에는 위험도를 높이는 요인(score_delta > 0)과 낮추는 요인(score_delta < 0) 모두 포함하세요. 안전한 지역도 표시하기 위해 음수 score_delta를 적극 활용하세요.
- 경로 위험 평가가 들어오면 segments[]에 각 구간별 점수와 이유를 제공합니다.

안전 권고
- 2–5개의 즉시 실행 가능 권고를 중요도 순으로 작성합니다.
- 과도한 공포 유발 표현, 법률/의료적 조언 단정, 불가능한 지시 금지.
`.trim();

    // 캘리브레이션 가이드(추가 주입)
    this.SYSTEM_PROMPT += `

캘리브레이션 가이드:
- 밝은 주간, 유동/차량 많음, 영업 중 상가/교통요지, CCTV 많음 => 보통 LOW(10~20), confidence 0.7~0.9
- 흐린 저녁, 보행자 중간, 상가 일부 영업, CCTV 보통 => 보통 MEDIUM(30~45)
- 심야 한산, 조도 낮음, 빈 골목, 폐쇄 상가, 사건 이력 인접 => HIGH(55~70)
- 특수 위험 신호(최근 중대 사건 2h/100m 내, 대규모 충돌 등) => CRITICAL(75~90)

반드시 위험/안전 요인을 모두 고려하여 음/양의 score_delta를 제공합니다.
데이터 결핍이 크면 score를 낮추고 confidence를 0.5 이하로 설정합니다.
`;

    // ======== 프롬프트: 개발자(스키마 고정) ========
    this.DEV_PROMPT_SCHEMA = `
다음 JSON 스키마로만 응답하세요. 추가 텍스트 금지.

{
  "location": {
    "lat": number,
    "lng": number,
    "address_hint": string
  },
  "context": {
    "timestamp_local": string,
    "weather": { "condition": string, "precip_mm": number, "temp_c": number, "wind_mps": number, "is_rain": boolean, "is_snow": boolean },
    "lighting": { "sun_state": "day|civil_twilight|nautical_twilight|night", "street_lights": "low|medium|high|unknown" },
    "foot_traffic": "low|medium|high|unknown",
    "vehicle_traffic": "low|medium|high|unknown",
    "open_pois": [ { "type": string, "name": string, "distance_m": number } ],
    "cctv_density": "low|medium|high|unknown",
    "recent_incidents": [ { "type": string, "age_hours": number, "distance_m": number, "severity": "minor|moderate|major" } ],
    "events": [ { "name": string, "distance_m": number, "crowd_level": "low|medium|high" } ]
  },
  "risk": {
    "score": number,
    "level": "LOW|MEDIUM|HIGH|CRITICAL",
    "confidence": number,
    "top_factors": [ { "factor": string, "direction": "↑|↓", "weight": number, "evidence": string } ],
    "data_gaps": [ string ],
    "calibration_notes": string
  },
  "map": {
    "color_hex": string,
    "radius_m": number,
    "marker": { "icon": "pin|shield|alert|footprint", "color": string }
  },
  "guidance": {
    "immediate_actions": [ string ],
    "route_advice": string,
    "meeting_point": string
  },
  "heat": {
    "contributors": [ { "name": string, "score_delta": number, "rationale": string } ]
  },
  "segments": [
    {
      "from": [number, number], "to": [number, number],
      "score": number, "level": "LOW|MEDIUM|HIGH|CRITICAL",
      "reasons": [ string ]
    }
  ]
}

검증 규칙:
- risk.level은 score 구간에 맞아야 합니다.
- color_hex, radius_m은 level과 일치해야 합니다.
- confidence는 0.0~1.0.
- 설명(evidence/rationale)은 구체적 맥락+거리/시간을 포함.
`.trim();
  }

  /**
   * 위치 기반 위험 지역 분석
   * @param {Object} params
   * @returns {Promise<Object>} { success, data, metadata|error }
   */
  async analyzeDangerZones({
    locationHistory = [],
    currentLocation,
    timestamp = new Date(),
    emergencyFacilities = { hospitals: [], police: [], stations: [] },

    // 선택 입력(없으면 unknown으로 처리)
    weather = null, // { condition, precip_mm, temp_c, wind_mps, is_rain, is_snow }
    lighting = null, // { sun_state, street_lights }
    footTraffic = "unknown", // "low|medium|high|unknown"
    vehicleTraffic = "unknown",
    openPois = [], // [{type,name,distance_m}]
    cctvDensity = "unknown", // "low|medium|high|unknown"
    recentIncidents = [], // [{type, age_hours, distance_m, severity}]
    events = [], // [{name, distance_m, crowd_level}]
    segments = [], // [{from:[lat,lng], to:[lat,lng]}]
    hasCrimeZoneData = false, // 범죄주의구간 데이터 활성화 여부
    hasSecurityFacilities = false, // 치안시설 데이터 활성화 여부
    hasEmergencyBells = false, // 안전비상벨 데이터 활성화 여부
    hasWomenSafetyData = false, // 여성밤길치안안전 데이터 활성화 여부
  }) {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("OpenAI API key not configured");
      return {
        success: false,
        error: "OpenAI API key not configured",
        data: this.generateDefaultSafetyInfo(
          currentLocation,
          timestamp,
          emergencyFacilities
        ),
      };
    }

    try {
      // ====== 기존 휴리스틱(참조/메타데이터 용) ======
      const hour = timestamp.getHours();
      const dayOfWeek = timestamp.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isNight = hour >= 22 || hour < 6;
      const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
      const timeOfDay =
        hour >= 6 && hour < 12
          ? "아침"
          : hour >= 12 && hour < 18
          ? "오후"
          : hour >= 18 && hour < 22
          ? "저녁"
          : "심야";

      const recentMovements = locationHistory.slice(-10);
      const hasLocationHistory = recentMovements.length > 0;
      const locationStability =
        recentMovements.length >= 3 ? "안정적" : "불안정";

      const hospitalCount = emergencyFacilities.hospitals?.length || 0;
      const policeCount = emergencyFacilities.police?.length || 0;
      const stationCount = emergencyFacilities.stations?.length || 0;
      const totalEmergencyFacilities =
        hospitalCount + policeCount + stationCount;

      // 각 시설까지의 최단 거리 계산
      const getClosestDistance = (facilities) => {
        if (!facilities || facilities.length === 0) return null;
        const distances = facilities.map(f => {
          const dist = calculateDistance(
            currentLocation.lat,
            currentLocation.lng,
            f.lat,
            f.lng
          );
          return Math.round(dist);
        });
        return Math.min(...distances);
      };

      const closestHospital = getClosestDistance(emergencyFacilities.hospitals);
      const closestPolice = getClosestDistance(emergencyFacilities.police);
      const closestStation = getClosestDistance(emergencyFacilities.stations);

      // 내부 메타 스코어(참고용)
      let riskScore = 0;
      if (hour >= 6 && hour < 18) riskScore += 0;
      else if (hour >= 18 && hour < 22) riskScore += 10;
      else if (hour >= 22 || hour < 2) riskScore += 25;
      else riskScore += 40;
      riskScore += policeCount >= 2 ? 0 : policeCount === 1 ? 10 : 30;
      riskScore += hospitalCount >= 2 ? 0 : hospitalCount === 1 ? 5 : 15;
      riskScore += stationCount >= 1 ? 0 : 15;

      const calculatedRiskLevel = riskScore <= 50 ? "low" : "medium";

      const contextMeta = {
        currentLocation: {
          lat: currentLocation.lat,
          lng: currentLocation.lng,
          address: `위도 ${Number(currentLocation.lat).toFixed(
            4
          )}, 경도 ${Number(currentLocation.lng).toFixed(4)}`,
        },
        timeContext: {
          hour,
          timeOfDay,
          dayOfWeek,
          dayName: [
            "일요일",
            "월요일",
            "화요일",
            "수요일",
            "목요일",
            "금요일",
            "토요일",
          ][dayOfWeek],
          isWeekend,
          isWeekday: !isWeekend,
          isNight,
          isRushHour,
        },
        locationHistory: {
          recentCount: recentMovements.length,
          hasHistory: hasLocationHistory,
          stability: locationStability,
        },
        nearbyEmergencyFacilities: {
          hospitalsCount: hospitalCount,
          policeCount: policeCount,
          stationsCount: stationCount,
          totalCount: totalEmergencyFacilities,
        },
        riskScore: {
          total: riskScore,
          timeScore:
            hour >= 6 && hour < 18
              ? 0
              : hour >= 18 && hour < 22
              ? 10
              : hour >= 22 || hour < 2
              ? 25
              : 40,
          policeScore: policeCount >= 2 ? 0 : policeCount === 1 ? 10 : 30,
          hospitalScore: hospitalCount >= 2 ? 0 : hospitalCount === 1 ? 5 : 15,
          stationScore: stationCount >= 1 ? 0 : 15,
          calculatedRiskLevel,
        },
      };

      // ====== 유저 프롬프트 템플릿 구성 ======
      const userPayload = {
        location: {
          lat: Number(currentLocation.lat),
          lng: Number(currentLocation.lng),
          address_hint: `위도 ${Number(currentLocation.lat).toFixed(
            4
          )}, 경도 ${Number(currentLocation.lng).toFixed(4)}`,
        },
        context: {
          timestamp_local: toLocalIso(timestamp),
          weather: normalizeWeather(weather),
          lighting: normalizeLighting(lighting, hour),
          foot_traffic: footTraffic || "unknown",
          vehicle_traffic: vehicleTraffic || "unknown",
          open_pois: (openPois || []).slice(0, 5),
          cctv_density: cctvDensity || "unknown",
          recent_incidents: recentIncidents || [],
          events: events || [],
        },
        segments: segments || [],
        emergency_facilities: {
          hospitals: hospitalCount,
          police: policeCount,
          stations: stationCount,
          closest_hospital_m: closestHospital,
          closest_police_m: closestPolice,
          closest_station_m: closestStation,
        },
      };

      console.log("\n====== 모바일 요청 로그 ======");
      console.log(`시간: ${timeOfDay} (${hour}시), ${isWeekend ? '주말' : '평일'}, isNight=${isNight}`);
      console.log(`응급시설: 병원=${hospitalCount}개(${closestHospital ? closestHospital + 'm' : 'N/A'}), 경찰=${policeCount}개(${closestPolice ? closestPolice + 'm' : 'N/A'}), 역=${stationCount}개(${closestStation ? closestStation + 'm' : 'N/A'})`);
      console.log(`조명: sun_state=${userPayload.context.lighting.sun_state}, street_lights=${userPayload.context.lighting.street_lights}`);
      console.log(`교통: foot=${footTraffic}, vehicle=${vehicleTraffic}, cctv=${cctvDensity}`);

      // ====== OpenAI 호출 ======
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: this.SYSTEM_PROMPT },
          { role: "system", content: this.DEV_PROMPT_SCHEMA },
          {
            role: "user",
            content:
              `다음 위치/맥락에 대해 현재 위험도를 평가하고, 이전 메시지의 스키마(JSON)로만 답하세요. 데이터가 부족하면 data_gaps에 사유를 명시하고 confidence를 낮추세요.

현재 시각: ${toLocalIso(timestamp)} (${timeOfDay}, ${
                isWeekend ? "주말" : "평일"
              })
위치: 위도 ${Number(currentLocation.lat).toFixed(6)}, 경도 ${Number(
                currentLocation.lng
              ).toFixed(6)}
주변 응급시설: 병원 ${hospitalCount}개${closestHospital ? ` (가장 가까운 곳: ${closestHospital}m)` : ''}, 경찰서 ${policeCount}개${closestPolice ? ` (가장 가까운 곳: ${closestPolice}m)` : ''}, 지하철역 ${stationCount}개${closestStation ? ` (가장 가까운 곳: ${closestStation}m)` : ''}

거리 기반 평가 가이드:
- 경찰서: 200m 이내(매우 안전, -15점), 200-500m(안전, -10점), 500-1000m(보통, -5점), 1000m 이상(위험, +10점)
- 병원: 300m 이내(안전, -8점), 300-800m(보통, -3점), 800m 이상(주의, +5점)
- 지하철역: 150m 이내(안전, -10점), 150-400m(보통, -5점), 400m 이상(주의, +3점)

중요: heat.contributors에 반드시 위험도를 높이는 요인(score_delta > 0)과 낮추는 요인(score_delta < 0) 모두 포함하세요.
예: [{"name": "조명 부족", "score_delta": 15, "rationale": "..."}, {"name": "CCTV 다수", "score_delta": -12, "rationale": "..."}]

${hasCrimeZoneData || hasSecurityFacilities || hasEmergencyBells || hasWomenSafetyData ? '\n\n**중요 - 안전지도 데이터 활성화**:\n' + (hasCrimeZoneData ? '- 범죄주의구간(성폭력): 실제 범죄 통계 기반 위험 지역 표시 중. 해당 지역의 위험도를 +15~25 상향 조정하고, 특히 야간에는 더욱 주의 필요. recommendations에 "범죄주의구간 표시 지역입니다. 가능한 우회하세요" 포함.\n' : '') + (hasSecurityFacilities ? '- 치안시설: 경찰서, CCTV 등 치안시설 위치 표시 중. 해당 시설 근처는 안전도가 높으므로 score를 -10~-15 하향 조정. recommendations에 "근처에 치안시설이 있습니다" 포함.\n' : '') + (hasEmergencyBells ? '- 안전비상벨: 비상벨 위치 표시 중. 비상벨 근처는 안전도가 높으므로 score를 -8~-12 하향 조정. recommendations에 "근처에 안전비상벨이 있습니다" 포함.\n' : '') + (hasWomenSafetyData ? '- 여성밤길치안안전: 여성 야간 안전 취약 지역 표시 중. 해당 지역의 위험도를 +10~20 상향 조정, 특히 야간 시간대에 더욱 주의. recommendations에 "여성 야간 취약 지역입니다. 밝은 곳으로 이동하세요" 포함.\n' : '') + '\n이 데이터들을 종합하여 위험도를 정확하게 평가하세요.' : ''}

` + JSON.stringify(userPayload),
          },
        ],
        response_format: { type: "json_object" },
        // 더 안정적으로: 편차 축소
        temperature: 0.2,
        top_p: 1.0,
        presence_penalty: 0,
        frequency_penalty: 0,
        max_tokens: 1500,
      });

      const raw = completion.choices?.[0]?.message?.content || "{}";
      const modelJson = safeJsonParse(raw, {});

      console.log(`\nAI 원본 응답: score=${modelJson.risk?.score}, level=${modelJson.risk?.level}, confidence=${modelJson.risk?.confidence}`);
      console.log(`data_gaps(${modelJson.risk?.data_gaps?.length || 0}개): ${modelJson.risk?.data_gaps?.join(', ') || 'none'}`);
      
      // 기본 점수 계산 (참고용)
      let expectedBase = 0;
      if (isNight) expectedBase += 25;
      if (totalEmergencyFacilities === 0) expectedBase += 20;
      else if (totalEmergencyFacilities === 1) expectedBase += 10;
      console.log(`예상 기본 점수: ${expectedBase}`);

      // ====== 최소 스키마 검증(간단) ======
      const ok = this.validateModelSchema(modelJson);
      if (!ok) {
        throw new Error(
          "Invalid response format from OpenAI (schema mismatch)"
        );
      }

      // ====== 하향 보정/동기화 파이프라인 ======
      this.enforceLevelByScore(modelJson); // 점수→레벨 강제
      console.log(`보정 1 (enforceLevelByScore): score=${modelJson.risk.score}, level=${modelJson.risk.level}`);
      
      this.downgradeOnLowConfidence(modelJson, userPayload); // 신뢰도/데이터결핍 하향 캡
      console.log(`보정 2 (downgradeOnLowConfidence): score=${modelJson.risk.score}, level=${modelJson.risk.level}`);
      
      this.applyContextualCaps(userPayload, modelJson); // 안전 시그널 기반 상한
      console.log(`보정 3 (applyContextualCaps): score=${modelJson.risk.score}, level=${modelJson.risk.level}`);
      
      this.reconcileLevelStyles(modelJson); // 색상/반경을 레벨과 절대 동기화

      // ====== 레거시 포맷으로도 변환(하위 호환) ======
      const legacy = this.toLegacyFormat(modelJson);

      console.log(`\n최종 결과: overallRiskLevel=${legacy.overallRiskLevel}, zones=${legacy.dangerZones.length}개`);
      console.log(`Zone levels: ${legacy.dangerZones.map(z => z.riskLevel).join(', ')}`);
      console.log(`최종 점수: ${modelJson.risk.score}`);
      console.log("============================\n");

      return {
        success: true,
        data: legacy, // <-- 기존 UI가 쓰던 포맷
        metadata: {
          timestamp: timestamp.toISOString(),
          model: this.model,
          context: contextMeta,
          raw_model: modelJson, // <-- 필요 시 사용(새 스키마)
        },
      };
    } catch (error) {
      console.error("Danger prediction error:", error);
      return {
        success: false,
        error: error.message,
        data: this.generateDefaultSafetyInfo(
          currentLocation,
          timestamp,
          emergencyFacilities
        ),
      };
    }
  }

  /* ===================== 보정/동기화 유틸 (클래스 내부) ===================== */

  levelFromScore(score) {
    if (score <= 24) return "LOW";
    if (score <= 49) return "MEDIUM";
    if (score <= 74) return "HIGH";
    return "CRITICAL";
  }

  // 모델이 준 레벨을 무시하고 점수에서 재산출
  enforceLevelByScore(modelJson) {
    const s = Math.max(0, Math.min(100, Number(modelJson?.risk?.score || 0)));
    const lvl = this.levelFromScore(s);
    modelJson.risk.score = s;
    modelJson.risk.level = lvl;
  }

  // 신뢰도 낮거나 데이터 결핍 많으면 하향 보정 + CRITICAL 캡
  downgradeOnLowConfidence(modelJson, userPayload) {
    const conf = Number(modelJson?.risk?.confidence ?? 0.5);
    // data_gaps는 문자열 배열이 아니라 쉼표로 구분된 문자열일 수 있음
    let gaps = 0;
    if (Array.isArray(modelJson?.risk?.data_gaps)) {
      gaps = modelJson.risk.data_gaps.length;
    } else if (typeof modelJson?.risk?.data_gaps === 'string') {
      gaps = modelJson.risk.data_gaps.split(',').length;
    }

    // 시간대와 응급시설 기반 기본 점수 계산
    const facilities = userPayload.emergency_facilities || {};
    const totalFacilities = (facilities.hospitals || 0) + (facilities.police || 0) + (facilities.stations || 0);
    const lighting = userPayload.context?.lighting || {};
    const isNight = lighting.sun_state === "night";
    
    // 기본 점수: 시간대 + 응급시설
    let baseScore = 0;
    if (isNight) baseScore += 25; // 심야
    else if (lighting.sun_state === "nautical_twilight") baseScore += 15;
    else if (lighting.sun_state === "civil_twilight") baseScore += 10;
    
    if (totalFacilities === 0) baseScore += 20;
    else if (totalFacilities === 1) baseScore += 10;
    else if (totalFacilities === 2) baseScore += 5;
    
    // 신뢰도가 낮으면 무조건 기본 점수 사용
    if (conf < 0.5) {
      modelJson.risk.score = baseScore;
      modelJson.risk.level = this.levelFromScore(modelJson.risk.score);
    } else if (conf < 0.6 || gaps >= 2) {
      // 일부 결핍이면 패널티 적용
      const penalty = gaps * 8 + (0.6 - conf) * 25;
      modelJson.risk.score = Math.max(
        baseScore,
        modelJson.risk.score - Math.max(0, penalty)
      );
      modelJson.risk.level = this.levelFromScore(modelJson.risk.score);
    }
    
    // CRITICAL 방지
    if (modelJson.risk.level === "CRITICAL") {
      modelJson.risk.level = "HIGH";
      modelJson.risk.score = Math.min(modelJson.risk.score, 74);
    }
  }

  // 밝음/혼잡/영업시설/CCTV 등 안전 시그널 다수면 MEDIUM 상한
  applyContextualCaps(userPayload, modelJson) {
    const ctx = userPayload.context || {};
    const light = ctx.lighting || {};
    const foot = String(ctx.foot_traffic || "unknown");
    const veh = String(ctx.vehicle_traffic || "unknown");
    const cctv = String(ctx.cctv_density || "unknown");
    const pois = Array.isArray(ctx.open_pois) ? ctx.open_pois : [];

    const isBright =
      light.sun_state === "day" ||
      (light.sun_state === "civil_twilight" && light.street_lights === "high");
    const isBusy = foot === "high" || veh === "high";
    const hasOpenPOIsNearby = pois.some(
      (p) =>
        Number(p.distance_m) <= 150 &&
        /편의점|카페|약국|지하철|경찰|병원|mart|convenience|pharmacy|subway|police|hospital/i.test(
          (p.type || "") + " " + (p.name || "")
        )
    );
    const isCCTVGood = cctv === "high";

    const safetySignals = [
      isBright,
      isBusy,
      hasOpenPOIsNearby,
      isCCTVGood,
    ].filter(Boolean).length;

    if (safetySignals >= 2) {
      modelJson.risk.score = Math.min(modelJson.risk.score, 49); // MEDIUM 상한
      modelJson.risk.level = this.levelFromScore(modelJson.risk.score);
    }
  }

  /**
   * 간단 스키마 검증 (외부 라이브러리 없이 핵심 필드만 확인)
   */
  validateModelSchema(obj) {
    if (!obj || typeof obj !== "object") return false;
    const must = ["location", "context", "risk", "map", "guidance", "heat"];
    for (const k of must) if (!(k in obj)) return false;

    // 핵심 필드
    if (typeof obj.location?.lat !== "number") return false;
    if (typeof obj.location?.lng !== "number") return false;
    if (!obj.risk || typeof obj.risk.score !== "number") return false;
    if (!obj.risk.level || typeof obj.risk.level !== "string") return false;
    if (!obj.map || typeof obj.map.color_hex !== "string") return false;
    if (typeof obj.map.radius_m !== "number") return false;
    if (!Array.isArray(obj.guidance?.immediate_actions)) return false;

    return true;
  }

  /**
   * 레벨에 맞게 색/반경을 절대 동기화 (일관 표현)
   */
  reconcileLevelStyles(modelJson) {
    const L = modelJson?.risk?.level || "MEDIUM";
    const style = this.levelStyle[L] || this.levelStyle.MEDIUM;

    modelJson.map.color_hex = style.color; // 절대 동기화
    modelJson.map.radius_m = style.radius; // 절대 동기화
    if (!modelJson.map.marker || typeof modelJson.map.marker !== "object") {
      modelJson.map.marker = { icon: "pin", color: style.color };
    } else {
      modelJson.map.marker.color = style.color;
      modelJson.map.marker.icon = modelJson.map.marker.icon || "pin";
    }
  }

  /**
   * 새 스키마(JSON) → 기존 포맷(legacy) 변환
   * legacy:
   *  - overallRiskLevel: "low|medium|high|critical|safe"
   *  - dangerZones: [{lat,lng,radius,riskLevel,reason,recommendations[]}]
   *  - safetyTips: [string]
   *  - analysisTimestamp: iso
   */
  toLegacyFormat(modelJson) {
    const levelMap = {
      LOW: "low",
      MEDIUM: "medium",
      HIGH: "high",
      CRITICAL: "critical",
    };

    const overallRiskLevel = levelMap[modelJson.risk.level] || "low";

    // 중심점 1개 + heat/segments 보조 → 5~7개로 구성
    const center = {
      lat: modelJson.location.lat,
      lng: modelJson.location.lng,
      radius: clamp(Math.round(modelJson.map.radius_m), 200, 500),
      riskLevel: levelMap[modelJson.risk.level] || "low",
      reason:
        modelJson.risk.top_factors?.[0]?.evidence ||
        "환경·조도·시설 밀도를 종합한 평가",
      recommendations: (modelJson.guidance.immediate_actions || []).slice(0, 3),
    };

    // heat.contributors 기반 주변 포인트 (위험/안전 지역 모두 포함)
    const contributors = modelJson.heat?.contributors || [];
    const extras = contributors
      .slice(0, 5)
      .map((h, i) => {
        const dMeters = 200 + i * 70; // 200~480m
        const bearing = (i * Math.PI * 2) / 5; // 균등 분포
        const off = offsetLatLng(center.lat, center.lng, dMeters, bearing);
        const delta = Number(h.score_delta || 0);

        // score_delta 기반 위험도 결정
        let lv;
        if (delta >= 30) lv = "critical";
        else if (delta >= 15) lv = "high";
        else if (delta >= 5) lv = "medium";
        else if (delta <= -10) lv = "safe"; // 안전 지역
        else lv = "low";

        return {
          lat: off.lat,
          lng: off.lng,
          radius: clamp(
            Math.round(modelJson.map.radius_m * (lv === "safe" ? 0.9 : 1.1)),
            180,
            500
          ),
          riskLevel: lv,
          reason: h.rationale || h.name || "요인 기반 가중치",
          recommendations:
            delta >= 10
              ? [
                  modelJson.guidance.route_advice ||
                    "밝은 길/혼잡 지역으로 경로 조정",
                ]
              : delta <= -10
              ? [
                  "안전한 지역입니다",
                  modelJson.guidance.meeting_point || "대기 장소로 적합",
                ]
              : ["일반적인 주의가 필요합니다"],
        };
      });

    // 가장 안전한 지역 추가
    const safestContributor = contributors.reduce((min, curr) => 
      (curr.score_delta || 0) < (min.score_delta || 0) ? curr : min
    , contributors[0] || { score_delta: 0 });
    
    // AI가 음수 score_delta를 제공하면 사용, 아니면 낮은 위험도 기반으로 생성
    let shouldAddSafest = false;
    let safestReason = "";
    
    if (safestContributor && safestContributor.score_delta <= 0) {
      shouldAddSafest = true;
      safestReason = safestContributor.rationale || safestContributor.name || "안전 요인 다수";
    } else if (modelJson.risk.level === "LOW" || modelJson.risk.score < 30) {
      shouldAddSafest = true;
      safestReason = "전반적으로 안전한 지역입니다";
    }
    
    if (shouldAddSafest) {
      const safestOff = offsetLatLng(center.lat, center.lng, 350, Math.PI / 3);
      extras.push({
        lat: safestOff.lat,
        lng: safestOff.lng,
        radius: 250,
        riskLevel: "safest",
        reason: `가장 안전한 지역: ${safestReason}`,
        recommendations: [
          "✓ 가장 안전한 지역입니다",
          "대기 또는 만남의 장소로 추천합니다",
          modelJson.guidance.meeting_point || "이동 시 이 방향을 고려하세요"
        ]
      });
    }

    // 최소 5개~최대 8개 유지 (중심 + 주변 + 가장 안전한 곳)
    const zones = [center, ...extras].slice(0, 8);
    while (zones.length < 5) zones.push({ ...center, radius: center.radius });

    return {
      overallRiskLevel,
      dangerZones: zones,
      safetyTips: (modelJson.guidance.immediate_actions || []).slice(0, 5),
      analysisTimestamp:
        modelJson.context?.timestamp_local || new Date().toISOString(),
    };
  }

  /**
   * 기본 안전 정보(폴백)
   */
  generateDefaultSafetyInfo(currentLocation, timestamp, emergencyFacilities) {
    const hour = timestamp.getHours();
    const isNight = hour >= 22 || hour < 6;
    const hospitalCount = emergencyFacilities.hospitals?.length || 0;
    const policeCount = emergencyFacilities.police?.length || 0;
    const stationCount = emergencyFacilities.stations?.length || 0;
    const totalEmergencyFacilities = hospitalCount + policeCount + stationCount;

    const safetyTips = [
      "주변을 주의 깊게 살피세요",
      isNight
        ? "밝은 곳으로 이동하고 어두운 길은 피하세요"
        : "사람이 많은 길로 이동하세요",
      "비상시 112 (경찰) 또는 119 (구급)에 연락하세요",
      totalEmergencyFacilities > 0
        ? "주변 응급시설 위치를 확인하세요 (🚨 버튼)"
        : "가까운 안전한 장소를 파악하세요",
      "가족이나 친구에게 현재 위치를 공유하세요",
    ];

    const dangerZones = [
      {
        lat: currentLocation.lat + 0.002,
        lng: currentLocation.lng + 0.002,
        radius: 300,
        riskLevel: "low",
        reason: isNight
          ? "야간 시간대로 가시성이 낮을 수 있습니다"
          : "일반적인 주의가 필요합니다",
        recommendations: [
          "주변을 잘 살피며 이동하세요",
          isNight ? "밝은 곳으로 이동하세요" : "사람이 많은 곳으로 이동하세요",
        ],
      },
    ];

    return {
      overallRiskLevel: isNight ? "medium" : "low",
      dangerZones,
      safetyTips,
      analysisTimestamp: timestamp.toISOString(),
    };
  }
}

/* ===================== 전역 유틸 ===================== */

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toLocalIso(date) {
  // 아시아/서울 기준 로컬 오프셋 포함 ISO (간단 버전: 시스템 타임존 사용)
  const t = new Date(date);
  const tzOffsetMin = -t.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? "+" : "-";
  const pad = (x, n = 2) => String(Math.floor(Math.abs(x))).padStart(n, "0");
  const yyyy = t.getFullYear();
  const MM = pad(t.getMonth() + 1);
  const dd = pad(t.getDate());
  const hh = pad(t.getHours());
  const mm = pad(t.getMinutes());
  const ss = pad(t.getSeconds());
  const offH = pad(tzOffsetMin / 60);
  const offM = pad(tzOffsetMin % 60);
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`;
}

// 날씨/조도 기본값 보정
function normalizeWeather(w) {
  if (w && typeof w === "object") {
    return {
      condition: w.condition ?? "unknown",
      precip_mm: Number.isFinite(w.precip_mm) ? w.precip_mm : 0,
      temp_c: Number.isFinite(w.temp_c) ? w.temp_c : 0,
      wind_mps: Number.isFinite(w.wind_mps) ? w.wind_mps : 0,
      is_rain: !!w.is_rain,
      is_snow: !!w.is_snow,
    };
  }
  return {
    condition: "unknown",
    precip_mm: 0,
    temp_c: 0,
    wind_mps: 0,
    is_rain: false,
    is_snow: false,
  };
}

function normalizeLighting(l, hour) {
  if (l && typeof l === "object") {
    return {
      sun_state: l.sun_state || inferSunState(hour),
      street_lights: l.street_lights || "unknown",
    };
  }
  return {
    sun_state: inferSunState(hour),
    street_lights: "unknown",
  };
}
function inferSunState(hour) {
  if (hour >= 6 && hour < 18) return "day";
  if (hour >= 18 && hour < 19) return "civil_twilight";
  if (hour >= 19 && hour < 20) return "nautical_twilight";
  return "night";
}

// 위도/경도에서 m거리/라디안 방위로 오프셋(간이 계산)
function offsetLatLng(lat, lng, meters, bearingRad) {
  const R = 6378137; // Earth radius (m)
  const dLat = (meters * Math.cos(bearingRad)) / R;
  const dLng =
    (meters * Math.sin(bearingRad)) / (R * Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + (dLat * 180) / Math.PI,
    lng: lng + (dLng * 180) / Math.PI,
  };
}

// 두 좌표 간 거리 계산 (Haversine formula, 미터 단위)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = DangerPredictionService;
