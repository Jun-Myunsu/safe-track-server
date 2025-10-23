/**
 * AI 채팅 컨트롤러
 * AI와의 채팅 요청을 처리합니다
 */
class AIChatController {
  constructor(aiChatService, userService, io) {
    this.aiChatService = aiChatService;
    this.userService = userService;
    this.io = io;
  }

  /**
   * AI에게 메시지 전송
   */
  async sendMessageToAI(socket, { message, location }) {
    const userId = socket.userId;

    if (!userId) {
      socket.emit('error', { message: '인증되지 않은 사용자입니다.' });
      return;
    }

    if (!message || !message.trim()) {
      socket.emit('error', { message: '메시지를 입력해주세요.' });
      return;
    }

    try {
      console.log(`[AI Chat] ${userId}: ${message}`);
      if (location) {
        console.log(`[AI Chat] Location: ${location.lat}, ${location.lng}`);
      }

      // AI 응답 생성 (위치 정보 포함)
      const aiResponse = await this.aiChatService.generateResponse(userId, message.trim(), location);

      console.log(`[AI Chat] AI -> ${userId}: ${aiResponse}`);

      // 사용자에게 AI 응답 전송
      socket.emit('aiMessage', {
        from: 'AI Assistant',
        message: aiResponse,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('AI 메시지 처리 오류:', error);
      socket.emit('error', { message: 'AI 메시지 처리 중 오류가 발생했습니다.' });
    }
  }

  /**
   * AI 대화 기록 초기화
   */
  clearAIConversation(socket) {
    const userId = socket.userId;

    if (!userId) {
      socket.emit('error', { message: '인증되지 않은 사용자입니다.' });
      return;
    }

    try {
      this.aiChatService.clearConversation(userId);
      socket.emit('aiConversationCleared', { message: '대화 기록이 초기화되었습니다.' });
      console.log(`[AI Chat] ${userId}의 대화 기록 초기화`);
    } catch (error) {
      console.error('AI 대화 기록 초기화 오류:', error);
      socket.emit('error', { message: '대화 기록 초기화 중 오류가 발생했습니다.' });
    }
  }

  /**
   * AI 서비스 상태 확인
   */
  getAIStatus(socket) {
    try {
      const status = {
        enabled: this.aiChatService.isEnabled(),
        stats: this.aiChatService.getStats()
      };
      socket.emit('aiStatus', status);
    } catch (error) {
      console.error('AI 상태 확인 오류:', error);
      socket.emit('error', { message: 'AI 상태 확인 중 오류가 발생했습니다.' });
    }
  }
}

module.exports = AIChatController;
