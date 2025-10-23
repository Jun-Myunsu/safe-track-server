/**
 * 애플리케이션 상수
 */

// 타임아웃 및 인터벌 (밀리초)
const TIMEOUTS = {
  USER_LIST_UPDATE_DELAY: 1000,  // 사용자 목록 업데이트 지연 시간
};

// 서버 URL
const SERVER_URLS = {
  DEFAULT_RENDER_URL: 'https://safe-track-server.onrender.com',
};

// 로그 메시지
const LOG_MESSAGES = {
  USER_CONNECTED: '사용자 연결',
  SERVER_STARTED: 'Safe Track Server running on port',
  KEEP_ALIVE_PING: 'Keep-alive ping',
  KEEP_ALIVE_FAILED: 'Keep-alive ping failed',
};

module.exports = {
  TIMEOUTS,
  SERVER_URLS,
  LOG_MESSAGES,
};
