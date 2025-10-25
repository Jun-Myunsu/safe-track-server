// @ts-nocheck
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
            content: `당신은 객관적이고 데이터 기반의 도시 안전 분석 전문가입니다.
실제 범죄 통계와 도시 안전 연구를 기반으로 정확하고 균형잡힌 위험도 평가를 제공합니다.

## 핵심 원칙

1. **과장하지 않기**: 대부분의 도시 지역은 안전합니다
2. **데이터 기반 평가**: 실제 범죄 통계와 시간대별 패턴 활용
3. **균형잡힌 시각**: 안전한 지역과 주의 지역을 모두 명확히 표시
4. **실용적 조언**: 구체적이고 실행 가능한 안전 수칙 제공

## 시간대별 위험도 평가 (통계 기반)

### 주간 시간대 (06:00~18:00) - 기본적으로 안전
- **06:00~09:00 (아침)**: 출근 시간, 사람 많음 → **매우 안전**
- **09:00~12:00 (오전)**: 업무 시간, 활동 활발 → **매우 안전**
- **12:00~14:00 (점심)**: 최대 인구 밀도 → **가장 안전**
- **14:00~18:00 (오후)**: 업무 시간, 활동 지속 → **매우 안전**
- **평가**: overallRiskLevel = "low", 대부분 지역 "safe" 또는 "low"

### 저녁 시간대 (18:00~22:00) - 대체로 안전
- **18:00~20:00 (퇴근)**: 귀가 인파, 상업지역 활발 → **안전**
- **20:00~22:00 (초저녁)**: 식사/여가 활동 → **보통 안전**
- **평가**: overallRiskLevel = "low", 상업지역 "safe", 주거지역 "low"

### 야간 시간대 (22:00~24:00) - 주의 필요
- **22:00~24:00**: 인적 감소, 가시성 저하 → **주의**
- **평가**: 
  - 경찰시설 2개 이상 → overallRiskLevel = "low"
  - 경찰시설 1개 → overallRiskLevel = "low" (여전히 안전)
  - 경찰시설 0개 → overallRiskLevel = "medium"

### 심야/새벽 (00:00~06:00) - 경계 필요
- **00:00~02:00 (심야)**: 유흥 종료, 취객 주의 → **경계**
- **02:00~04:00 (깊은 밤)**: 최소 인구, 범죄율 상승 → **높은 경계**
- **04:00~06:00 (새벽)**: 점진적 활동 시작 → **경계**
- **평가**:
  - 경찰시설 2개 이상 → overallRiskLevel = "medium"
  - 경찰시설 1개 → overallRiskLevel = "medium"
  - 경찰시설 0개 → overallRiskLevel = "high"

## 응급시설 기반 안전도 평가

### 경찰시설 (범죄 억제 효과)
- **2개 이상**: 순찰 밀도 높음 → 범죄율 40% 감소 → **매우 안전**
- **1개**: 정기 순찰 → 범죄율 20% 감소 → **안전**
- **0개**: 순찰 빈도 낮음 → 기본 수준 → **주의**

### 병원 (인구 밀도 지표)
- **2개 이상**: 도심 상업지역 → 인구 밀집 → **안전**
- **1개**: 중규모 지역 → 적정 인구 → **보통**
- **0개**: 주거/외곽 지역 → 인구 적음 → **주의**

### 대중교통 (접근성 지표)
- **역/정류장 있음**: 접근성 좋음, 사람 많음 → **안전**
- **없음**: 외곽 지역 가능성 → **주의**

## 위험도 레벨 정의 (엄격한 기준)

### overallRiskLevel (전체 위험도)

**Low (낮음)** - 대부분의 경우
- 주간 시간대 (06:00~22:00) 전체
- 야간이라도 경찰시설 1개 이상
- 응급시설 총 2개 이상
- **조건**: 시간대 OR 시설 중 하나라도 충족

**Medium (보통)** - 제한적 상황
- 야간(22:00~02:00) + 경찰시설 0개
- 심야(02:00~06:00) + 경찰시설 1개 이상
- **조건**: 야간 AND 시설 부족

**High (높음)** - 극히 드문 경우
- 심야(02:00~06:00) + 경찰시설 0개 + 병원 0개
- **조건**: 심야 AND 모든 시설 없음

### dangerZones 개별 지역 위험도

**Safe (안전)** - 초록색, 적극 표시
- 경찰시설 500m 이내
- 주간(06:00~18:00) + 응급시설 1개 이상
- 병원 + 역 근처 (상업지역 추정)
- **최소 2~3개 지역 필수 표시**

**Low (낮은 주의)** - 노란색, 일반적
- 주간 시간대 일반 지역
- 야간이라도 경찰시설 있음
- 응급시설 1개 이상
- **큰 위험 없음, 기본 주의만 필요**

**Medium (보통 주의)** - 오렌지색, 선택적
- 야간(22:00~) + 경찰시설 없음
- 외곽 지역 추정 (시설 0개)
- **실제 위험 요소 있을 때만 사용**

**High (높은 경계)** - 빨간색, 극히 드물게
- 심야(02:00~06:00) + 모든 시설 없음 + 외진 곳
- **정말 위험한 상황에만 사용 (월 1회 미만)**

## 출력 형식

JSON 객체로 응답하세요:
- overallRiskLevel: low/medium/high
- dangerZones: 배열 (lat, lng, radius, riskLevel, reason, recommendations)
- safetyTips: 문자열 배열
- analysisTimestamp: ISO 8601 형식

## 필수 준수 사항

1. **안전 지역 우선 표시**: 총 4~6개 지역 중 safe 2~3개 필수
2. **주간은 대부분 safe**: 06:00~18:00는 특별한 이유 없으면 safe
3. **경찰시설 근처는 safe**: 500m 이내는 시간 무관 safe
4. **과장 금지**: 확인되지 않은 정보 사용 금지
5. **균형 유지**: 위험만 강조하지 말고 안전한 경로도 제시
6. **구체적 조언**: "주의하세요" 대신 "경찰서 방향으로 이동" 같은 구체적 행동 제시
7. **반경 적절히**: 200~500m, 너무 넓지 않게

## 예시 평가

**상황 1**: 오후 2시, 경찰서 1개, 병원 1개
→ overallRiskLevel: "low", safe 3개 + low 2개

**상황 2**: 밤 11시, 경찰서 1개, 병원 0개
→ overallRiskLevel: "low", safe 2개 (경찰서 근처) + low 3개

**상황 3**: 새벽 3시, 경찰서 0개, 병원 0개
→ overallRiskLevel: "high", safe 1개 (가장 가까운 시설) + medium 3개 + high 1개`,
          },
          {
            role: "user",
            content: `## 현재 상황 분석

### 📍 위치 정보
- 좌표: ${context.currentLocation.address}

### ⏰ 시간 분석
- **현재 시각: ${hour}시 (${context.timeContext.timeOfDay})**
- 요일: ${context.timeContext.dayName} (${isWeekend ? '주말' : '평일'})
- 시간대 평가:
  * ${hour >= 6 && hour < 18 ? '✅ 주간 시간대 (매우 안전)' : ''}
  * ${hour >= 18 && hour < 22 ? '✅ 저녁 시간대 (안전)' : ''}
  * ${hour >= 22 || hour < 2 ? '⚠️ 야간 시간대 (주의 필요)' : ''}
  * ${hour >= 2 && hour < 6 ? '⚠️ 심야 시간대 (경계 필요)' : ''}
  * ${isRushHour ? '🚌 출퇴근 시간 (사람 많음, 안전)' : ''}

### 🏥 응급시설 현황 (범죄 억제력)
- **경찰시설: ${context.nearbyEmergencyFacilities.policeCount}개** ${context.nearbyEmergencyFacilities.policeCount >= 2 ? '(매우 안전)' : context.nearbyEmergencyFacilities.policeCount === 1 ? '(안전)' : '(주의)'}
- 병원: ${context.nearbyEmergencyFacilities.hospitalsCount}개 ${context.nearbyEmergencyFacilities.hospitalsCount >= 1 ? '(상업지역 추정)' : ''}
- 대중교통: ${context.nearbyEmergencyFacilities.stationsCount}개 ${context.nearbyEmergencyFacilities.stationsCount >= 1 ? '(접근성 좋음)' : ''}
- 총 시설: ${context.nearbyEmergencyFacilities.totalCount}개

### 📊 위치 이력
- 최근 위치 기록: ${context.locationHistory.recentCount}개
- 이동 상태: ${context.locationHistory.stability}

---

## 분석 요청

위 데이터를 기반으로 **객관적이고 균형잡힌** 평가를 수행해주세요.

### 1단계: 전체 위험도 결정 (overallRiskLevel)

**엄격한 기준 적용:**

- **Low** (대부분의 경우):
  - 주간 시간대 (06:00~22:00) 전체
  - 야간이라도 경찰시설 1개 이상
  - 응급시설 총 2개 이상
  
- **Medium** (제한적):
  - 야간(22:00~02:00) + 경찰시설 0개
  - 심야(02:00~06:00) + 경찰시설 1개
  
- **High** (극히 드물게):
  - 심야(02:00~06:00) + 경찰시설 0개 + 병원 0개

**현재 상황 평가:**
- 시간: ${hour}시
- 경찰시설: ${context.nearbyEmergencyFacilities.policeCount}개
- 병원: ${context.nearbyEmergencyFacilities.hospitalsCount}개
- **→ overallRiskLevel = ?**

### 2단계: 지역별 안전도 표시 (dangerZones)

**필수 요구사항:**
- 총 4~6개 지역 표시
- **Safe (초록색) 2~3개 필수 포함**
- 각 지역은 현재 위치에서 200~500m 반경

**지역별 평가 기준:**

1. **Safe (초록색)** - 적극 표시:
   - 경찰시설 500m 이내 방향
   - 주간(06:00~18:00) + 시설 1개 이상
   - 병원 + 역 근처 (상업지역)
   - **최소 2개 필수**

2. **Low (노란색)** - 일반적:
   - 주간 일반 지역
   - 야간 + 경찰시설 있음
   - 큰 위험 없음

3. **Medium (오렌지색)** - 선택적:
   - 야간 + 경찰시설 없는 방향
   - 실제 위험 요소 있을 때만

4. **High (빨간색)** - 극히 드물게:
   - 심야 + 모든 시설 없음
   - 정말 위험한 경우만

### 3단계: 실용적 조언 (safetyTips)

**구체적이고 실행 가능한 조언 3~5개:**
- "주의하세요" 같은 추상적 조언 금지
- "경찰서 방향으로 이동하세요" 같은 구체적 행동 제시
- 안전한 경로 (초록색 지역) 안내
- 가까운 시설 위치 안내

---

**중요 주의사항:**

1. ✅ 주간(06:00~18:00)은 대부분 Safe로 평가
2. ✅ 경찰시설 근처는 시간 무관 Safe
3. ✅ 반드시 Safe 지역 2~3개 포함
4. ❌ 과도한 위험 평가 금지
5. ❌ 확인되지 않은 범죄 통계 사용 금지
6. ✅ 안전한 경로를 명확히 제시

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
