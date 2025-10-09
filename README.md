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