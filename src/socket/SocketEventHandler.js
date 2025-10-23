/**
 * Socket.IO 이벤트 핸들러
 * 모든 소켓 이벤트를 등록하고 관리
 */
class SocketEventHandler {
  constructor(io, controllers, services) {
    this.io = io;
    this.controllers = controllers;
    this.services = services;
  }

  /**
   * 연결 이벤트 핸들러 등록
   */
  initialize() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      this.registerAuthEvents(socket);
      this.registerUserEvents(socket);
      this.registerLocationEvents(socket);
      this.registerChatEvents(socket);
      this.registerAIChatEvents(socket);
      this.registerUtilityEvents(socket);
      this.registerDisconnectEvent(socket);
    });
  }

  /**
   * 새 연결 처리
   */
  handleConnection(socket) {
    console.log('사용자 연결:', socket.id, '| IP:', socket.handshake.address);
    socket.emit('userList', this.services.userService.getAllOnlineUsers());
  }

  /**
   * 인증 관련 이벤트 등록
   */
  registerAuthEvents(socket) {
    const { authController } = this.controllers;

    socket.on('validateSession', (data) =>
      authController.handleValidateSession(socket, data)
    );
    socket.on('register', (data) =>
      authController.handleRegister(socket, data)
    );
    socket.on('login', (data) =>
      authController.handleLogin(socket, data)
    );
    socket.on('logout', (data) =>
      authController.handleLogout(socket, data)
    );
  }

  /**
   * 사용자 관련 이벤트 등록
   */
  registerUserEvents(socket) {
    const { userController } = this.controllers;

    socket.on('checkUserId', (data) =>
      userController.handleCheckUserId(socket, data)
    );
    socket.on('reconnect', (data) =>
      userController.handleReconnect(socket, data)
    );
    socket.on('searchUsers', (data) =>
      userController.handleSearchUsers(socket, data)
    );
    socket.on('addFriend', (data) =>
      userController.handleAddFriend(socket, data)
    );
    socket.on('getFriends', (data) =>
      userController.handleGetFriends(socket, data)
    );
    socket.on('removeFriend', (data) =>
      userController.handleRemoveFriend(socket, data)
    );
  }

  /**
   * 위치 공유 관련 이벤트 등록
   */
  registerLocationEvents(socket) {
    const { locationController } = this.controllers;

    socket.on('startTracking', (data) =>
      locationController.handleStartTracking(socket, data)
    );
    socket.on('locationUpdate', (data) =>
      locationController.handleLocationUpdate(socket, data)
    );
    socket.on('stopTracking', (data) =>
      locationController.handleStopTracking(socket, data)
    );
    socket.on('requestLocationShare', (data) =>
      locationController.handleRequestLocationShare(socket, data)
    );
    socket.on('respondLocationShare', (data) =>
      locationController.handleRespondLocationShare(socket, data)
    );
    socket.on('stopLocationShare', (data) =>
      locationController.handleStopLocationShare(socket, data)
    );
    socket.on('stopReceivingShare', (data) =>
      locationController.handleStopReceivingShare(socket, data)
    );
    socket.on('requestCurrentLocation', (data) =>
      locationController.handleRequestCurrentLocation(socket, data)
    );
  }

  /**
   * 채팅 관련 이벤트 등록
   */
  registerChatEvents(socket) {
    const { chatController } = this.controllers;

    socket.on('sendMessage', (data) =>
      chatController.handleSendMessage(socket, data)
    );
    socket.on('getConnectedUsers', () =>
      chatController.handleGetConnectedUsers(socket)
    );
  }

  /**
   * AI 채팅 관련 이벤트 등록
   */
  registerAIChatEvents(socket) {
    const { aiChatController } = this.controllers;

    if (!aiChatController) {
      return;
    }

    socket.on('sendMessageToAI', (data) =>
      aiChatController.sendMessageToAI(socket, data)
    );
    socket.on('clearAIConversation', () =>
      aiChatController.clearAIConversation(socket)
    );
    socket.on('getAIStatus', () =>
      aiChatController.getAIStatus(socket)
    );
  }

  /**
   * 유틸리티 이벤트 등록 (ping/pong 등)
   */
  registerUtilityEvents(socket) {
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });
  }

  /**
   * 연결 해제 이벤트 등록
   */
  registerDisconnectEvent(socket) {
    socket.on('disconnect', () => this.handleDisconnect(socket));
  }

  /**
   * 연결 해제 처리
   */
  handleDisconnect(socket) {
    const { userService, locationService } = this.services;

    if (!socket.userId) {
      return;
    }

    const user = userService.getOnlineUser(socket.userId);
    if (!user || user.socketId !== socket.id) {
      return;
    }

    // 사용자 추적 중지 및 정리
    userService.setUserTracking(socket.userId, false);
    locationService.removeLocation(socket.userId);
    userService.removeOnlineUser(socket.userId);

    // 추적 상태 업데이트 브로드캐스트
    this.io.emit('trackingStatusUpdate', {
      userId: socket.userId,
      isTracking: false
    });

    // 사용자 목록 업데이트 (약간의 지연 후)
    setTimeout(() => {
      this.io.emit('userList', userService.getAllOnlineUsers());
    }, 1000);
  }
}

module.exports = SocketEventHandler;
