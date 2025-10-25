// @ts-nocheck
const OpenAI = require("openai");

/**
 * AI 기반 위험 지역 예측 서비스 (강화 버전)
 * - 정밀 프롬프트/스키마 통합
 * - JSON 응답 강제(response_format)
 * - 신스키마 → 레거시 포맷 자동 변환(하위 호환)
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
- 경로 위험 평가가 들어오면 segments[]에 각 구간별 점수와 이유를 제공합니다.

안전 권고
- 2–5개의 즉시 실행 가능 권고를 중요도 순으로 작성합니다.
- 과도한 공포 유발 표현, 법률/의료적 조언 단정, 불가능한 지시 금지.
`.trim();

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
    weather = null,          // { condition, precip_mm, temp_c, wind_mps, is_rain, is_snow }
    lighting = null,         // { sun_state, street_lights }
    footTraffic = "unknown", // "low|medium|high|unknown"
    vehicleTraffic = "unknown",
    openPois = [],           // [{type,name,distance_m}]
    cctvDensity = "unknown", // "low|medium|high|unknown"
    recentIncidents = [],    // [{type, age_hours, distance_m, severity}]
    events = [],             // [{name, distance_m, crowd_level}]
    segments = []            // [{from:[lat,lng], to:[lat,lng]}]
  }) {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("OpenAI API key not configured");
      return {
        success: false,
        error: "OpenAI API key not configured",
        data: this.generateDefaultSafetyInfo(currentLocation, timestamp, emergencyFacilities),
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
        hour >= 6 && hour < 12 ? "아침" :
        hour >= 12 && hour < 18 ? "오후" :
        hour >= 18 && hour < 22 ? "저녁" : "심야";

      const recentMovements = locationHistory.slice(-10);
      const hasLocationHistory = recentMovements.length > 0;
      const locationStability = recentMovements.length >= 3 ? "안정적" : "불안정";

      const hospitalCount = emergencyFacilities.hospitals?.length || 0;
      const policeCount = emergencyFacilities.police?.length || 0;
      const stationCount = emergencyFacilities.stations?.length || 0;
      const totalEmergencyFacilities = hospitalCount + policeCount + stationCount;

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
          address: `위도 ${Number(currentLocation.lat).toFixed(4)}, 경도 ${Number(currentLocation.lng).toFixed(4)}`
        },
        timeContext: {
          hour,
          timeOfDay,
          dayOfWeek,
          dayName: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][dayOfWeek],
          isWeekend,
          isWeekday: !isWeekend,
          isNight,
          isRushHour
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
          timeScore: (hour >= 6 && hour < 18) ? 0 : (hour >= 18 && hour < 22) ? 10 : (hour >= 22 || hour < 2) ? 25 : 40,
          policeScore: policeCount >= 2 ? 0 : policeCount === 1 ? 10 : 30,
          hospitalScore: hospitalCount >= 2 ? 0 : hospitalCount === 1 ? 5 : 15,
          stationScore: stationCount >= 1 ? 0 : 15,
          calculatedRiskLevel
        },
      };

      // ====== 유저 프롬프트 템플릿 구성 ======
      const userPayload = {
        location: {
          lat: Number(currentLocation.lat),
          lng: Number(currentLocation.lng),
          address_hint: "",
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
        segments: (segments || []),
      };

      // ====== OpenAI 호출 ======
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: this.SYSTEM_PROMPT },
          { role: "system", content: this.DEV_PROMPT_SCHEMA },
          {
            role: "user",
            content:
              "다음 위치/맥락에 대해 현재 위험도를 평가하고, 이전 메시지의 스키마(JSON)로만 답하세요. 데이터가 부족하면 data_gaps에 사유를 명시하고 confidence를 낮추세요.\n\n" +
              JSON.stringify(userPayload),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        top_p: 0.9,
        presence_penalty: 0,
        frequency_penalty: 0,
        max_tokens: 1500,
      });

      const raw = completion.choices?.[0]?.message?.content || "{}";
      const modelJson = safeJsonParse(raw, {});

      // ====== 최소 스키마 검증(간단) ======
      const ok = this.validateModelSchema(modelJson);
      if (!ok) {
        throw new Error("Invalid response format from OpenAI (schema mismatch)");
      }

      // 레벨↔스타일 보정(모델이 잘못 주면 교정)
      this.reconcileLevelStyles(modelJson);

      // ====== 레거시 포맷으로도 변환(하위 호환) ======
      const legacy = this.toLegacyFormat(modelJson);

      return {
        success: true,
        data: legacy,                  // <-- 기존 UI가 쓰던 포맷
        metadata: {
          timestamp: timestamp.toISOString(),
          model: this.model,
          context: contextMeta,
          raw_model: modelJson,       // <-- 필요 시 사용(새 스키마)
        },
      };
    } catch (error) {
      console.error("Danger prediction error:", error);
      return {
        success: false,
        error: error.message,
        data: this.generateDefaultSafetyInfo(currentLocation, timestamp, emergencyFacilities),
      };
    }
  }

  /**
   * 간단 스키마 검증 (외부 라이브러리 없이 핵심 필드만 확인)
   */
  validateModelSchema(obj) {
    if (!obj || typeof obj !== "object") return false;
    const must = [
      "location", "context", "risk", "map", "guidance", "heat"
    ];
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
   * 모델이 level에 맞지 않는 색/반경을 준 경우 스타일 보정
   */
  reconcileLevelStyles(modelJson) {
    const L = modelJson?.risk?.level || "MEDIUM";
    const style = this.levelStyle[L] || this.levelStyle.MEDIUM;
    if (!/^#?[0-9a-fA-F]{6}$/.test(modelJson.map.color_hex || "")) {
      modelJson.map.color_hex = style.color;
    }
    if (!Number.isFinite(modelJson.map.radius_m) || modelJson.map.radius_m <= 0) {
      modelJson.map.radius_m = style.radius;
    }
    if (!modelJson.map.marker || typeof modelJson.map.marker !== "object") {
      modelJson.map.marker = { icon: "pin", color: style.color };
    } else {
      modelJson.map.marker.color = modelJson.map.marker.color || style.color;
      modelJson.map.marker.icon = modelJson.map.marker.icon || "pin";
    }
  }

  /**
   * 새 스키마(JSON) → 기존 포맷(legacy) 변환
   * legacy:
   *  - overallRiskLevel: "low|medium|high"
   *  - dangerZones: [{lat,lng,radius,riskLevel,reason,recommendations[]}]
   *  - safetyTips: [string]
   *  - analysisTimestamp: iso
   */
  toLegacyFormat(modelJson) {
    const levelMap = {
      LOW: "low",
      MEDIUM: "low",   // 기존 코드가 0-50을 low로 썼으므로 MEDIUM도 low로 매핑
      HIGH: "medium",
      CRITICAL: "medium",
    };

    const overallRiskLevel = levelMap[modelJson.risk.level] || "low";

    // 중심점 1개 + heat/segments 보조 → 4~6개로 구성
    const center = {
      lat: modelJson.location.lat,
      lng: modelJson.location.lng,
      radius: clamp(Math.round(modelJson.map.radius_m), 200, 500),
      riskLevel: levelMap[modelJson.risk.level] || "low",
      reason:
        (modelJson.risk.top_factors?.[0]?.evidence) ||
        "환경·조도·시설 밀도를 종합한 평가",
      recommendations: (modelJson.guidance.immediate_actions || []).slice(0, 3),
    };

    // heat.contributors 기반 주변 포인트(간단하게 방사형 샘플)
    const extras = (modelJson.heat?.contributors || [])
      .slice(0, 4)
      .map((h, i) => {
        const dMeters = 200 + i * 60; // 200~380m
        const bearing = (i * Math.PI) / 2; // 0, 90, 180, 270 deg
        const off = offsetLatLng(center.lat, center.lng, dMeters, bearing);
        const up = (h.score_delta || 0) >= 0;
        const lv = up ? "medium" : "low";
        return {
          lat: off.lat,
          lng: off.lng,
          radius: clamp(Math.round(modelJson.map.radius_m * 1.1), 220, 500),
          riskLevel: lv,
          reason: h.rationale || h.name || "요인 기반 가중치",
          recommendations: up
            ? [modelJson.guidance.route_advice || "밝은 길/혼잡 지역으로 경로 조정"]
            : [modelJson.guidance.meeting_point || "인근 개방형 시설로 이동"],
        };
      });

    // 최소 4개~최대 6개 유지
    const zones = [center, ...extras].slice(0, 6);
    while (zones.length < 4) zones.push({ ...center, radius: center.radius });

    return {
      overallRiskLevel,
      dangerZones: zones,
      safetyTips: (modelJson.guidance.immediate_actions || []).slice(0, 5),
      analysisTimestamp: modelJson.context?.timestamp_local || new Date().toISOString(),
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
      isNight ? "밝은 곳으로 이동하고 어두운 길은 피하세요" : "사람이 많은 길로 이동하세요",
      "비상시 112 (경찰) 또는 119 (구급)에 연락하세요",
      totalEmergencyFacilities > 0 ? "주변 응급시설 위치를 확인하세요 (🚨 버튼)" : "가까운 안전한 장소를 파악하세요",
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

/* ===================== 유틸 ===================== */

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
  const dLng = (meters * Math.sin(bearingRad)) / (R * Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + (dLat * 180) / Math.PI,
    lng: lng + (dLng * 180) / Math.PI,
  };
}

module.exports = DangerPredictionService;
