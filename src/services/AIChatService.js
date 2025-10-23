const OpenAI = require('openai');

class AIChatService {
  constructor() {
    this.conversations = new Map();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  createConversation(userId) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }
    return this.conversations.get(userId);
  }

  addMessage(userId, message, isUser = true) {
    const conversation = this.createConversation(userId);
    conversation.push({
      role: isUser ? 'user' : 'assistant',
      content: message,
      timestamp: new Date().toISOString()
    });
  }

  getConversation(userId) {
    return this.conversations.get(userId) || [];
  }

  async generateResponse(userId, message, location) {
    try {
      this.addMessage(userId, message, true);
      
      const conversation = this.getConversation(userId);
      let systemContent = 'Safe Track 밤길 안전 위치 공유 앱의 AI 어시스턴트입니다. 위치 공유, 친구 추가, 실시간 채팅, 밤길 안전 기능에 대해 도움을 드립니다. 친근하고 도움이 되는 답변을 해주세요.';
      
      if (location) {
        systemContent += ` 사용자의 현재 위치는 위도 ${location.lat.toFixed(4)}, 경도 ${location.lng.toFixed(4)}입니다. 위치 관련 질문에 이 정보를 활용하세요.`;
      }
      
      const messages = [
        {
          role: 'system',
          content: systemContent
        },
        ...conversation.slice(-10).map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 300,
        temperature: 0.7
      });

      const response = completion.choices[0].message.content;
      this.addMessage(userId, response, false);
      
      return response;
    } catch (error) {
      console.error('OpenAI API 오류:', error);
      const fallbackResponse = this.getSimpleResponse(message, location);
      this.addMessage(userId, fallbackResponse, false);
      return fallbackResponse;
    }
  }

  getSimpleResponse(message, location) {
    const lowerMessage = message.toLowerCase();
    
    // 키워드 기반 응답
    if (lowerMessage.includes('안녕') || lowerMessage.includes('하이') || lowerMessage.includes('hi') || lowerMessage.includes('hello')) {
      return '안녕하세요! 반가워요. 무엇을 도와드릴까요? 😊';
    }
    
    if (lowerMessage.includes('위치') || lowerMessage.includes('공유') || lowerMessage.includes('location')) {
      if (location) {
        return `현재 위치는 위도 ${location.lat.toFixed(4)}, 경도 ${location.lng.toFixed(4)} 입니다. 친구를 추가하고 위치 공유 요청을 보내보세요! 📍`;
      }
      return '위치 공유 기능에 대해 궁금하신가요? 친구를 추가하고 위치 공유 요청을 보내보세요! 📍';
    }
    
    if (lowerMessage.includes('안전') || lowerMessage.includes('밤길') || lowerMessage.includes('safety')) {
      if (location) {
        return `현재 위치에서 안전하게 이동하세요! 친구와 위치를 공유하면 더 안심할 수 있어요. 밤길에는 밝은 곳으로 다니세요. 🚪`;
      }
      return '밤길 안전을 위해 친구와 위치를 공유하세요! 밝은 곳으로 다니고, 위험하면 112에 신고하세요. 🚪';
    }
    
    if (lowerMessage.includes('어디') || lowerMessage.includes('지역') || lowerMessage.includes('where')) {
      if (location) {
        return `현재 위치는 위도 ${location.lat.toFixed(4)}, 경도 ${location.lng.toFixed(4)} 입니다. 지도에서 확인해보세요! 🗺️`;
      }
      return '위치 추적을 시작하면 현재 위치를 확인할 수 있어요! 🗺️';
    }
    
    if (lowerMessage.includes('고마워') || lowerMessage.includes('감사') || lowerMessage.includes('thank')) {
      return '천만에요! Safe Track을 이용해 주셔서 감사합니다. 🙏';
    }
    
    if (lowerMessage.includes('도움') || lowerMessage.includes('도와줘') || lowerMessage.includes('help')) {
      return '물론이죠! 무엇이 필요하신가요? 위치 공유, 채팅, 친구 추가 등에 대해 알려드릴 수 있어요. 👍';
    }
    
    // 기본 응답
    const responses = [
      '흥미로운 이야기네요! 더 말씀해 주세요. 😊',
      '그렇군요! 다른 궁금한 점이 있으신가요?',
      '이해했어요. 더 자세히 설명해 드릴까요?',
      '좋은 질문이에요! Safe Track에 대해 더 알고 싶으신 것이 있나요?'
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  clearConversation(userId) {
    this.conversations.delete(userId);
  }
  
  isEnabled() {
    return true;
  }
  
  getStats() {
    return {
      totalConversations: this.conversations.size,
      totalMessages: Array.from(this.conversations.values()).reduce((sum, conv) => sum + conv.length, 0)
    };
  }
}

module.exports = AIChatService;