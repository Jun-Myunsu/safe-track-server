const OpenAI = require("openai");

/**
 * AI 기반 위험 지역 예측 서비스
 * OpenAI GPT-4를 사용하여 위치 데이터 기반 위험도 분석
 */
class DangerPredictionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * 위치 기반 위험 지역 분석
   * @param {Object} params - 분석 파라미터
   * @returns {Promise<Object>} 위험 분석 결과
   */
  async analyzeDangerZones({
    locationHistory = [],
    currentLocation,
    timestamp = new Date(),
    emergencyFacilities = { hospitals: [], police: [], stations: [] },
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
      const hour = timestamp.getHours();
      const dayOfWeek = timestamp.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isNight = hour >= 22 || hour < 6;
      const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);

      // 시간대 상세 분류
      const timeOfDay = hour >= 6 && hour < 12 ? '아침' :
                        hour >= 12 && hour < 18 ? '오후' :
                        hour >= 18 && hour < 22 ? '저녁' : '심야';
      const isLateNight = hour >= 23 || hour < 4;
      const isDawn = hour >= 4 && hour < 6;

      // 위치 이력 분석 (5분 간격 고려)
      const recentMovements = locationHistory.slice(-10);
      const hasLocationHistory = recentMovements.length > 0;
      const locationStability = recentMovements.length >= 3 ? '안정적' : '불안정';

      // 응급시설 밀집도 분석
      const hospitalCount = emergencyFacilities.hospitals?.length || 0;
      const policeCount = emergencyFacilities.police?.length || 0;
      const stationCount = emergencyFacilities.stations?.length || 0;
      const totalEmergencyFacilities = hospitalCount + policeCount + stationCount;

      const facilityDensity = totalEmergencyFacilities === 0 ? '매우 낮음' :
                              totalEmergencyFacilities <= 2 ? '낮음' :
                              totalEmergencyFacilities <= 5 ? '보통' : '높음';

      // 응급대응 수준 평가
      const emergencyResponseLevel =
        policeCount >= 2 ? '높음' :
        policeCount === 1 ? '보통' : '낮음';

      const context = {
        currentLocation: {
          lat: currentLocation.lat,
          lng: currentLocation.lng,
          address: `위도 ${currentLocation.lat.toFixed(
            4
          )}, 경도 ${currentLocation.lng.toFixed(4)}`,
        },
        timeContext: {
          hour,
          timeOfDay,
          dayOfWeek,
          dayName: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][dayOfWeek],
          isWeekend,
          isWeekday: !isWeekend,
          isNight,
          isLateNight,
          isDawn,
          isRushHour,
          isMidnight: hour === 0 || hour === 12,
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
          facilityDensity,
          emergencyResponseLevel,
          hasHospital: hospitalCount > 0,
          hasPolice: policeCount > 0,
          hasStation: stationCount > 0,
        },
      };

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `당신은 도시 안전 및 범죄 예방 전문가입니다.
사용자의 실시간 위치 데이터, 시간대, 주변 환경을 종합 분석하여 위험 지역을 예측하고 실용적인 안전 권고사항을 제공합니다.

## 분석 기준 (중요도 순)

1. **시간대별 위험도 평가** (가장 중요)
   - 심야/새벽(23:00~06:00): 가시성 저하, 인적 드문 지역, 범죄율 증가
   - 저녁(18:00~22:00): 퇴근 후 유흥가 주의, 골목길 조명 부족
   - 출퇴근(07:00~09:00, 17:00~19:00): 사람 많음 → 소매치기 주의, 교통사고
   - 주말 야간: 유흥가 위험 증가
   - 주간(09:00~18:00): 기본적으로 안전

2. **응급시설 분포** (범죄 억제력)
   - 경찰서/파출소 500m 이내: 순찰 빈도 높음 → 범죄 억제
   - 경찰시설 500~1000m: 보통 수준 안전
   - 경찰시설 1000m 이상: 순찰 적음 → 주의 필요
   - 병원 근처: 응급상황 대응 가능

3. **지역 특성 추론**
   - 응급시설 밀집(3개 이상): 상업지역 → 사람 많음 → 안전
   - 응급시설 적음(0~1개): 주거/외곽지역 → 야간 위험
   - 경찰시설만 있음: 치안 중점지역 → 안전
   - 병원만 있음: 의료지구 → 보통 안전

4. **요일별 패턴**
   - 평일 주간: 직장인 많음 → 안전
   - 평일 야간: 주거지역 한산 → 주의
   - 주말 주간: 상업지역 번화 → 안전
   - 주말 야간: 유흥가 위험 → 주의

5. **위치 기반 지역 추론**
   - 현재 좌표로 도심/외곽 추정
   - 경찰시설 분포로 치안 수준 파악
   - 병원 분포로 인구 밀도 추정

## 위험도 평가 기준 (보수적으로 평가)

### 전체 위험도 (overallRiskLevel)
- **High**: 심야(23시~04시) + 경찰시설 없음
- **Medium**: 야간(22시~06시) + 경찰시설 부족(0~1개)
- **Low**: 그 외 모든 경우 (주간, 경찰시설 있음)

### 지역별 위험도 (개별 dangerZones)
- **반드시 안전한 지역과 주의 지역을 함께 표시**
- 총 4~6개 지역 표시 (안전 지역 2~3개 필수 포함)
- **Safe**: 경찰시설 500m 이내 OR 주간(06~18시) + 활동적 지역 (초록색으로 표시)
- **Low**: 일반적인 주의 지역, 큰 위험 없음 (노란색으로 표시)
- **Medium**: 야간 + 시설 부족 + 골목길 추정 (오렌지색으로 표시)
- **High**: 심야 + 시설 없음 + 외진 곳 (빨간색, 매우 드물게 사용)

## 출력 형식

반드시 다음 JSON 형식으로만 응답하세요:
{
  "overallRiskLevel": "low|medium|high",
  "dangerZones": [
    {
      "lat": 위도,
      "lng": 경도,
      "radius": 반경(미터),
      "riskLevel": "safe|low|medium|high",
      "reason": "지역 특성 설명 (안전한 이유 또는 주의 필요한 이유)",
      "recommendations": ["권고사항1", "권고사항2"]
    }
  ],
  "safetyTips": ["우선순위별 안전 팁 3~5개"],
  "analysisTimestamp": "${timestamp.toISOString()}"
}

중요 지침:
1. 과도하게 위험하다고 평가하지 마세요
2. **반드시 안전한 지역(safe) 2~3개를 포함**하여 사용자가 안전한 경로를 파악하도록 도와주세요
3. Safe: 경찰시설 근처, 주간 시간대, 상업지역 추정
4. Low: 일반적인 주의, 큰 위험 없음
5. Medium: 야간 + 시설 부족
6. High: 정말 심각한 상황(심야+시설없음+정지)에만 사용
7. 확인되지 않은 범죄 통계나 가짜 정보를 사용하지 마세요`,
          },
          {
            role: "user",
            content: `## 현재 상황 분석

### 📍 위치 정보
- 좌표: ${context.currentLocation.address}

### ⏰ 시간 분석
- 현재 시각: ${hour}시 (${context.timeContext.timeOfDay})
- 요일: ${context.timeContext.dayName} (${isWeekend ? '주말' : '평일'})
- 시간대 특성:
  * ${isNight ? '✅ 야간 시간대' : '❌ 주간 시간대'}
  * ${isLateNight ? '✅ 심야 시간대 (위험 증가)' : '❌ 일반 시간대'}
  * ${isDawn ? '✅ 새벽 시간대' : '❌ 새벽 아님'}
  * ${isRushHour ? '✅ 출퇴근 시간 (혼잡)' : '❌ 비혼잡 시간'}

### 🏥 응급시설 현황
- 병원: ${context.nearbyEmergencyFacilities.hospitalsCount}개
- 경찰서: ${context.nearbyEmergencyFacilities.policeCount}개
- 파출소: ${context.nearbyEmergencyFacilities.stationsCount}개
- 총 응급시설: ${context.nearbyEmergencyFacilities.totalCount}개
- 시설 밀집도: ${context.nearbyEmergencyFacilities.facilityDensity}
- 응급대응 수준: ${context.nearbyEmergencyFacilities.emergencyResponseLevel}
- 경찰 시설: ${context.nearbyEmergencyFacilities.hasPolice ? '있음 (범죄 억제력 있음)' : '없음 (범죄 억제력 낮음)'}

### 📊 위치 이력
- 최근 위치 기록: ${context.locationHistory.recentCount}개
- 위치 추적 안정성: ${context.locationHistory.stability}
- 이력 데이터: ${context.locationHistory.hasHistory ? '있음' : '없음'}

## 분석 요청

위 정보를 종합하여 다음을 수행해주세요:

1. **전체 위험도 평가** (보수적으로):
   - High: 심야(23~04시) + 경찰시설 없음만
   - Medium: 야간 + 경찰시설 부족
   - Low: 그 외 대부분의 경우

2. **지역별 안전도 표시** (중요!):
   - 총 4~6개 지역 표시
   - **반드시 안전한 지역(safe) 2~3개 포함 필수**
   - Safe (초록색): 경찰시설 500m 이내, 주간 시간대, 상업지역 추정
   - Low (노란색): 일반적인 주의, 큰 위험 없음
   - Medium (오렌지색): 야간 + 시설 부족
   - High (빨간색): 심야 + 시설 없음 (극히 드물게)

3. **실용적 권고사항**:
   - 안전한 경로 안내 (초록색 지역으로 이동)
   - 가까운 안전 시설 방향 제시

중요:
- **반드시 안전한 지역(safe) 2~3개를 포함**할 것
- 과도하게 위험하다고 평가하지 말 것
- 주간이면 대부분 Safe 또는 Low로 평가
- 경찰시설 근처면 Safe로 평가
- 안전한 지역을 명확히 표시하여 사용자가 안전한 경로를 선택하도록 도움

JSON 형식으로 응답해주세요.`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1500,
      });

      const result = JSON.parse(completion.choices[0].message.content);

      if (
        !result.overallRiskLevel ||
        !result.dangerZones ||
        !result.safetyTips
      ) {
        throw new Error("Invalid response format from OpenAI");
      }

      return {
        success: true,
        data: result,
        metadata: {
          timestamp: timestamp.toISOString(),
          model: "gpt-4o-mini",
          context,
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

  /**
   * 기본 안전 정보 생성
   * @param {Object} currentLocation - 현재 위치
   * @param {Date} timestamp - 현재 시간
   * @param {Object} emergencyFacilities - 응급 시설
   * @returns {Object} 기본 안전 정보
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

module.exports = DangerPredictionService;
