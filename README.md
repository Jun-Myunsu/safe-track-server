# Safe Track Server

실시간 위치 공유 서버 - Node.js + Socket.IO

## 기능
- 사용자 등록/로그인 (bcrypt 암호화)
- 실시간 위치 추적 및 공유
- 위치 공유 권한 관리
- 실시간 채팅
- JSON 파일 기반 사용자 데이터 저장

## 배포 (Render)

1. GitHub에 코드 업로드
2. Render에서 Web Service 생성
3. 환경 변수 설정:
   - `NODE_ENV=production`
4. 빌드 명령어: `npm install`
5. 시작 명령어: `npm start`

## 로컬 실행

```bash
npm install
npm start
```

## API 엔드포인트
- Socket.IO 연결: `/socket.io/`
- 포트: 3000 (환경변수 PORT로 변경 가능)

## 클라이언트 연결
클라이언트에서 서버 URL을 배포된 주소로 변경 필요:
```javascript
const serverUrl = 'https://your-render-app.onrender.com'
```

## 라이선스

Copyright (c) 2025 Safe Track. All Rights Reserved.

이 소프트웨어는 독점 라이선스(Proprietary License)로 보호됩니다.

**제한 사항:**
- 상업적 사용 금지
- 수정 및 배포 금지
- 역공학 금지

**허용 사항:**
- 개인적, 비상업적 목적의 열람 및 학습
- 저작권자의 명시적 서면 허가가 있는 경우에 한해 사용 가능

자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.