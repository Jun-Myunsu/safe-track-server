# 안전지도 연동 가이드

## API 키
```
HBUSTKVD-HBUS-HBUS-HBUS-HBUSTKVDTH
```

## 클라이언트 구현 (React Native)

### 1. WMS 레이어 오버레이
```javascript
import MapView, { UrlTile } from 'react-native-maps';

const SafeMapOverlay = () => (
  <MapView>
    {/* 범죄주의구간(성폭력) */}
    <UrlTile
      urlTemplate="https://www.safemap.go.kr/openApiService/wms/getLayerData.do?apikey=HBUSTKVD-HBUS-HBUS-HBUS-HBUSTKVDTH&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=A2SM_CRMNLHSPOT_TOT&STYLES=A2SM_CrmnlHspot_Tot_Rape&FORMAT=image/png&TRANSPARENT=true&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&BBOX={minX},{minY},{maxX},{maxY}"
      maximumZ={19}
      minimumZ={10}
      opacity={0.5}
      zIndex={1}
    />
  </MapView>
);
```

### 2. 사용 가능한 레이어

| 레이어명 | 스타일 | 설명 |
|---------|--------|------|
| A2SM_CRMNLHSPOT_TOT | A2SM_CrmnlHspot_Tot_Rape | 성폭력 주의구간 |
| A2SM_CRMNLHSPOT_TOT | A2SM_CrmnlHspot_Tot_Robbery | 강도 주의구간 |
| A2SM_CRMNLHSPOT_TOT | A2SM_CrmnlHspot_Tot_Theft | 절도 주의구간 |
| A2SM_CRMNLHSPOT_TOT | A2SM_CrmnlHspot_Tot_Violence | 폭력 주의구간 |

### 3. 범례 확인
```
https://www.safemap.go.kr/legend/legendApiXml.do?apikey=HBUSTKVD-HBUS-HBUS-HBUS-HBUSTKVDTH&layer=A2SM_CRMNLHSPOT_TOT&style=A2SM_CrmnlHspot_Tot_Rape
```

## 서버 연동 (선택사항)

범죄 데이터를 서버로 전달하여 AI 분석에 반영:

```javascript
// 클라이언트에서 서버로 전송
const crimeData = {
  nearCrimeZone: true,  // 범죄 주의구간 근처 여부
  crimeTypes: ['rape', 'robbery'],  // 주변 범죄 유형
  distance: 150  // 범죄 주의구간까지 거리(m)
};

fetch('/api/danger-analysis', {
  method: 'POST',
  body: JSON.stringify({
    currentLocation: { lat, lng },
    crimeData: crimeData
  })
});
```

## 주의사항

1. **API 키 보안**: 클라이언트에 하드코딩하지 말고 환경변수 사용
2. **성능**: 너무 많은 레이어를 동시에 표시하면 느려질 수 있음
3. **투명도**: opacity를 0.3~0.5로 설정하여 지도가 가려지지 않도록
4. **줌 레벨**: minimumZ를 10 이상으로 설정 (너무 멀리서는 보이지 않게)

## 구현 우선순위

1. ✅ **현재**: 시간대 + 응급시설 기반 평가 (작동 중)
2. 🔄 **다음**: 안전지도 WMS 레이어 오버레이 (클라이언트)
3. 🔄 **선택**: 범죄 데이터를 서버 AI 분석에 반영
