const SocketRateLimiter = require('../middleware/socketRateLimiter');

/**
 * Socket.IO 이벤트 핸들러
 * 모든 소켓 이벤트를 등록하고 관리
 */
class SocketEventHandler {
  constructor(io, controllers, services) {
    this.io = io;
    this.controllers = controllers;
    this.services = services;
    this.rateLimiter = new SocketRateLimiter();
    this.connectionCount = new Map();
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
      this.registerSettingsEvents(socket);
      this.registerUtilityEvents(socket);
      this.registerDisconnectEvent(socket);
    });
  }

  /**
   * 새 연결 처리
   */
  handleConnection(socket) {
    const ip = socket.handshake.address;
    
    // IP별 동시 접속 수 제한
    const currentConnections = this.connectionCount.get(ip) || 0;
    if (currentConnections >= 5) {
      socket.emit('error', { message: '동시 접속 수 초과' });
      socket.disconnect(true);
      return;
    }
    
    this.connectionCount.set(ip, currentConnections + 1);
    
    socket.on('disconnect', () => {
      const count = this.connectionCount.get(ip) || 1;
      if (count <= 1) {
        this.connectionCount.delete(ip);
      } else {
        this.connectionCount.set(ip, count - 1);
      }
    });
    
    console.log('사용자 연결:', socket.id, '| IP:', ip);
    socket.emit('userList', this.services.userService.getAllOnlineUsers());
  }

  /**
   * 인증 관련 이벤트 등록
   */
  registerAuthEvents(socket) {
    const { authController } = this.controllers;
    const ip = socket.handshake.address;

    socket.on('validateSession', (data) => {
      if (!this.rateLimiter.check(ip, 'validateSession', 10, 60000)) {
        socket.emit('error', { message: '요청이 너무 빠릅니다' });
        return;
      }
      authController.handleValidateSession(socket, data);
    });
    
    socket.on('register', (data) => {
      // if (!this.rateLimiter.check(ip, 'register', 3, 300000)) {
      //   socket.emit('registerError', { message: '회원가입 시도가 너무 많습니다' });
      //   return;
      // }
      authController.handleRegister(socket, data);
    });
    
    socket.on('login', (data) => {
      if (!this.rateLimiter.check(ip, 'login', 100, 300000)) {
        socket.emit('loginError', { message: '로그인 시도가 너무 많습니다' });
        return;
      }
      authController.handleLogin(socket, data);
    });
    
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
    const { locationService, locationLogService } = this.services;

    socket.on('startTracking', (data) => {
      try {
        locationController.handleStartTracking(socket, data);
        if (data.userId) {
          locationLogService.startTracking(data.userId, () => {
            const location = locationService.getLocation(data.userId);
            return location || null;
          });
        }
      } catch (error) {
        console.error('위치 추적 시작 실패:', error);
        socket.emit('error', { message: '위치 추적 시작 실패' });
      }
    });
    socket.on('locationUpdate', (data) => {
      locationController.handleLocationUpdate(socket, data);
    });
    socket.on('stopTracking', async (data) => {
      try {
        locationController.handleStopTracking(socket, data);
        if (data.userId) {
          await locationLogService.stopTracking(data.userId);
        }
      } catch (error) {
        console.error('위치 추적 중지 실패:', error);
        socket.emit('error', { message: '위치 추적 중지 실패' });
      }
    });
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
   * 설정 관련 이벤트 등록
   */
  registerSettingsEvents(socket) {
    const { settingsController } = this.controllers;

    socket.on('getRegistrationStatus', () =>
      settingsController.getRegistrationStatus(socket)
    );
    socket.on('toggleRegistration', (data) =>
      settingsController.toggleRegistration(socket, data)
    );
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
  async handleDisconnect(socket) {
    try {
      const { userService, locationService, locationLogService } = this.services;

      if (!socket.userId) {
        return;
      }

      const user = userService.getOnlineUser(socket.userId);
      if (!user || user.socketId !== socket.id) {
        return;
      }

      const disconnectedUserId = socket.userId;

      // 1. 공유 상태 정리: 내가 공유하고 있던 사용자들에게 알림
      const sharedUsers = locationService.getSharedUsers(disconnectedUserId);
      if (sharedUsers && sharedUsers.size > 0) {
        sharedUsers.forEach(targetUserId => {
          const targetUser = userService.getOnlineUser(targetUserId);
          if (targetUser) {
            this.io.to(targetUser.socketId).emit('locationShareStopped', {
              fromUserId: disconnectedUserId,
              fromName: disconnectedUserId
            });
            this.io.to(targetUser.socketId).emit('locationRemoved', {
              userId: disconnectedUserId
            });
          }
          // 권한 제거
          locationService.stopLocationShare(disconnectedUserId, targetUserId);
        });
      }

      // 2. 공유 상태 정리: 나에게 공유하고 있던 사용자들의 권한 제거
      const allOnlineUsers = userService.getAllOnlineUsers();
      allOnlineUsers.forEach(otherUser => {
        const otherSharedUsers = locationService.getSharedUsers(otherUser.id);
        if (otherSharedUsers && otherSharedUsers.has(disconnectedUserId)) {
          locationService.stopLocationShare(otherUser.id, disconnectedUserId);
        }
      });

      // 3. 사용자 추적 중지 및 정리
      userService.setUserTracking(disconnectedUserId, false);
      locationService.removeLocation(disconnectedUserId);
      await locationLogService.stopTracking(disconnectedUserId);
      userService.removeOnlineUser(disconnectedUserId);

      // 4. 추적 상태 업데이트 브로드캐스트
      this.io.emit('trackingStatusUpdate', {
        userId: disconnectedUserId,
        isTracking: false
      });

      // 5. 사용자 목록 업데이트 (약간의 지연 후)
      setTimeout(() => {
        this.io.emit('userList', userService.getAllOnlineUsers());
      }, 1000);

      console.log(`✅ 사용자 연결 해제 및 공유 상태 정리 완료: ${disconnectedUserId}`);
    } catch (error) {
      console.error('연결 해제 처리 실패:', error);
    }
  }
}

module.exports = SocketEventHandler;
