/**
 * Keep-Alive 서비스
 * 프로덕션 환경에서 서버 슬립 방지를 위한 자체 ping
 */
class KeepAliveService {
  constructor(serverUrl, intervalMinutes = 5) {
    this.serverUrl = serverUrl;
    this.intervalMs = intervalMinutes * 60 * 1000;
    this.intervalId = null;
  }

  /**
   * Keep-alive 시작
   */
  start() {
    if (process.env.NODE_ENV !== 'production') {
      console.log('Keep-alive: 개발 환경에서는 비활성화됨');
      return;
    }

    this.intervalId = setInterval(() => {
      this.ping();
    }, this.intervalMs);

    console.log(`Keep-alive: ${this.intervalMs / 1000}초마다 ${this.serverUrl}/ping 호출`);
  }

  /**
   * Keep-alive 중지
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Keep-alive: 중지됨');
    }
  }

  /**
   * 서버에 ping 요청
   */
  async ping() {
    try {
      const response = await fetch(`${this.serverUrl}/ping`);
      const data = await response.json();
      console.log('Keep-alive ping:', data.status, '| Users:', data.onlineUsers);
    } catch (error) {
      console.log('Keep-alive ping failed:', error.message);
    }
  }
}

module.exports = KeepAliveService;
