class ChatController {
  constructor(chatService, userService, io) {
    this.chatService = chatService;
    this.userService = userService;
    this.io = io;
  }

  handleSendMessage(socket, data) {
    try {
      const { targetUserId, message } = data;
      const fromUserId = socket.userId;
      
      const messageData = this.chatService.createMessage(fromUserId, targetUserId, message);
      
      const targetUser = this.userService.getOnlineUser(targetUserId);
      this.io.to(targetUser.socketId).emit('messageReceived', messageData);
      socket.emit('messageSent', messageData);
    } catch (error) {
      socket.emit('chatError', { message: error.message });
    }
  }
}

module.exports = ChatController;