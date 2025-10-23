class ChatController {
  constructor(chatService, userService, io) {
    this.chatService = chatService;
    this.userService = userService;
    this.io = io;
  }

  /**
   * 메시지 전송 처리 (단일 또는 그룹)
   */
  handleSendMessage(socket, data) {
    try {
      const { targetUserId, message } = data;
      const fromUserId = socket.userId;

      // targetUserId가 있으면 1:1 메시지, 없으면 그룹 메시지
      if (targetUserId) {
        // 1:1 메시지 (기존 방식)
        const messageData = this.chatService.createMessage(fromUserId, targetUserId, message);

        const targetUser = this.userService.getOnlineUser(targetUserId);
        this.io.to(targetUser.socketId).emit('messageReceived', messageData);
        socket.emit('messageSent', messageData);
      } else {
        // 그룹 메시지 (연결된 모든 사용자에게)
        const messageData = this.chatService.createGroupMessage(fromUserId, message);

        // 모든 수신자에게 메시지 전송
        messageData.recipients.forEach(recipientId => {
          const recipientUser = this.userService.getOnlineUser(recipientId);
          if (recipientUser) {
            this.io.to(recipientUser.socketId).emit('messageReceived', {
              from: fromUserId,
              to: recipientId,
              message,
              timestamp: messageData.timestamp,
              isGroupMessage: true
            });
          }
        });

        // 발신자에게 전송 확인
        socket.emit('messageSent', {
          ...messageData,
          isGroupMessage: true
        });
      }
    } catch (error) {
      socket.emit('chatError', { message: error.message });
    }
  }

  /**
   * 연결된 사용자 목록 가져오기
   */
  handleGetConnectedUsers(socket) {
    try {
      const fromUserId = socket.userId;
      const connectedUsers = this.chatService.getConnectedUsers(fromUserId);

      socket.emit('connectedUsers', { users: connectedUsers });
    } catch (error) {
      socket.emit('chatError', { message: error.message });
    }
  }
}

module.exports = ChatController;