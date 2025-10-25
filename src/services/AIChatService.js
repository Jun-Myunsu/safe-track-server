const OpenAI = require("openai");

class AIChatService {
  constructor() {
    this.conversations = new Map();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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
      role: isUser ? "user" : "assistant",
      content: message,
      timestamp: new Date().toISOString(),
    });
  }

  getConversation(userId) {
    return this.conversations.get(userId) || [];
  }

  async generateResponse(userId, message, location) {
    try {
      this.addMessage(userId, message, true);

      const conversation = this.getConversation(userId);
      let systemContent = `당신은 친근하고 도움이 되는 AI 어시스턴트입니다. 기본적으로 안전 관리 전문가로서 Safe Track 밤길 안전 앱을 도와주지만, 사용자의 모든 질문에 친절하고 유용하게 답변합니다.

주요 기능:
- 밤길 안전 및 범죄 예방 조언
- 위치 기반 주변 시설 정보 (식당, 병원, 경찰서, 편의점, 약국, 카페 등)
- 날씨, 교통, 지역 정보
- 응급 상황 대처법
- 일상 대화 및 일반 질문

답변 원칙:
1. 반드시 한국어로만 답변하세요
2. 모든 질문에 친절하고 유용하게 답변하세요
3. 위치 정보가 있으면 구체적인 지역 정보를 제공하세요
4. 확실하지 않은 정보는 일반적인 조언을 제공하세요
5. 한국 지역이면 한국어 지명과 시설명을 사용하세요
6. 질문의 범위를 제한하지 말고 다양한 주제에 답변하세요`;

      if (location) {
        systemContent += `\n\n사용자의 현재 위치: 위도 ${location.lat.toFixed(
          6
        )}, 경도 ${location.lng.toFixed(
          6
        )}\n이 좌표를 기반으로 주변 시설, 날씨, 교통 등의 정보를 구체적으로 제공하세요.`;
      }

      const messages = [
        {
          role: "system",
          content: systemContent,
        },
        ...conversation.slice(-10).map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      ];

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const response = completion.choices[0].message.content;
      this.addMessage(userId, response, false);

      return response;
    } catch (error) {
      console.error("OpenAI API 오류:", error);
      const fallbackResponse = this.getSimpleResponse(message, location);
      this.addMessage(userId, fallbackResponse, false);
      return fallbackResponse;
    }
  }

  getSimpleResponse(message, location) {
    const lowerMessage = message.toLowerCase();

    // 키워드 기반 응답
    if (
      lowerMessage.includes("안녕") ||
      lowerMessage.includes("하이") ||
      lowerMessage.includes("hi") ||
      lowerMessage.includes("hello")
    ) {
      return "안녕하세요! 반가워요. 무엇을 도와드릴까요? 😊";
    }

    if (
      lowerMessage.includes("위치") ||
      lowerMessage.includes("공유") ||
      lowerMessage.includes("location")
    ) {
      if (location) {
        return `현재 위치는 위도 ${location.lat.toFixed(
          4
        )}, 경도 ${location.lng.toFixed(
          4
        )} 입니다. 친구를 추가하고 위치 공유 요청을 보내보세요! 📍`;
      }
      return "위치 공유 기능에 대해 궁금하신가요? 친구를 추가하고 위치 공유 요청을 보내보세요! 📍";
    }

    if (
      lowerMessage.includes("안전") ||
      lowerMessage.includes("밤길") ||
      lowerMessage.includes("safety")
    ) {
      if (location) {
        return `현재 위치에서 안전하게 이동하세요! 친구와 위치를 공유하면 더 안심할 수 있어요. 밤길에는 밝은 곳으로 다니세요. 🚪`;
      }
      return "밤길 안전을 위해 친구와 위치를 공유하세요! 밝은 곳으로 다니고, 위험하면 112에 신고하세요. 🚪";
    }

    if (
      lowerMessage.includes("어디") ||
      lowerMessage.includes("지역") ||
      lowerMessage.includes("where")
    ) {
      if (location) {
        return `현재 위치는 위도 ${location.lat.toFixed(
          4
        )}, 경도 ${location.lng.toFixed(4)} 입니다. 지도에서 확인해보세요! 🗺️`;
      }
      return "위치 추적을 시작하면 현재 위치를 확인할 수 있어요! 🗺️";
    }

    if (
      lowerMessage.includes("고마워") ||
      lowerMessage.includes("감사") ||
      lowerMessage.includes("thank")
    ) {
      return "천만에요! Safe Track을 이용해 주셔서 감사합니다. 🙏";
    }

    if (
      lowerMessage.includes("도움") ||
      lowerMessage.includes("도와줘") ||
      lowerMessage.includes("help")
    ) {
      return "물론이죠! 무엇이 필요하신가요? 위치 공유, 채팅, 친구 추가 등에 대해 알려드릴 수 있어요. 👍";
    }

    // 기본 응답
    const responses = [
      "흥미로운 이야기네요! 더 말씀해 주세요. 😊",
      "그렇군요! 다른 궁금한 점이 있으신가요?",
      "이해했어요. 더 자세히 설명해 드릴까요?",
      "좋은 질문이에요! Safe Track에 대해 더 알고 싶으신 것이 있나요?",
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
      totalMessages: Array.from(this.conversations.values()).reduce(
        (sum, conv) => sum + conv.length,
        0
      ),
    };
  }

  async generateEmergencyTip() {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "당신은 응급상황 대처 전문가입니다. 밤길 안전, 응급상황 대처, 범죄 예방 등에 대한 실용적이고 구체적인 상식을 한국어로 제공해주세요. 반드시 한국어로만 답변하세요. 제목과 내용을 JSON 형식으로 반환해주세요.",
          },
          {
            role: "user",
            content:
              '응급상황에서 도움이 되는 실용적인 상식 하나를 한국어로 알려주세요. 제목과 내용을 포함해서 {"title": "제목", "content": "내용"} 형식으로 주세요. 내용은 2-3문장으로 간결하게 작성해주세요. 반드시 한국어로만 답변하세요.',
          },
        ],
        max_tokens: 300,
        temperature: 0.8,
      });

      const response = completion.choices[0].message.content;

      try {
        return JSON.parse(response);
      } catch {
        return {
          title: "응급상황 대처법",
          content: response,
        };
      }
    } catch (error) {
      console.error("OpenAI API 오류:", error);
      return {
        title: "긴급 연락처",
        content:
          "응급상황 시 112(경찰), 119(소방/구급), 1366(여성 긴급전화)로 연락하세요. 위험을 느끼면 주변 사람들에게 도움을 요청하고, 밝은 곳으로 이동하세요.",
      };
    }
  }
}

module.exports = AIChatService;
