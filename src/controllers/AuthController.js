const AuthService = require('../services/AuthService');

class AuthController {
  constructor(userService, locationService, io) {
    this.userService = userService;
    this.locationService = locationService;
    this.io = io;
  }

  /**
   * 로그인 후 공유 상태 복원 (추적 상태는 항상 false로 시작)
   */
  restoreShareState(socket, userId) {
    const user = this.userService.getOnlineUser(userId);
    if (!user) return;

    // 내가 공유하고 있는 사용자 목록
    const sharedUsers = [];
    const sharePermissions = this.locationService.getSharedUsers(userId);
    if (sharePermissions) {
      sharePermissions.forEach(targetUserId => {
        const targetUser = this.userService.getOnlineUser(targetUserId);
        if (targetUser) {
          sharedUsers.push({ id: targetUserId, name: targetUserId });
        }
      });
    }

    // 나를 받고 있는 사용자 목록
    const receivedShares = [];
    const allUsers = this.userService.getAllOnlineUsers();
    allUsers.forEach(otherUser => {
      const otherSharePermissions = this.locationService.getSharedUsers(otherUser.id);
      if (otherSharePermissions && otherSharePermissions.has(userId)) {
        receivedShares.push({ id: otherUser.id, name: otherUser.id });
      }
    });

    // 추적 상태는 항상 false로 시작 (수동 시작 필요)
    socket.emit('restoreState', {
      sharedUsers,
      receivedShares,
      isTracking: false
    });
  }

  async handleValidateSession(socket, data) {
    try {
      const { sessionId } = data;
      const session = await AuthService.validateSession(sessionId);

      if (session) {
        const userId = session.user_id;
        
        // 중복 로그인 방지
        const existingUser = this.userService.getOnlineUser(userId);
        if (existingUser && existingUser.socketId !== socket.id) {
          const existingSocket = this.io.sockets.sockets.get(existingUser.socketId);
          if (existingSocket) {
            existingSocket.emit('forceLogout', { reason: '다른 기기에서 로그인되었습니다' });
            setTimeout(() => existingSocket.disconnect(true), 100);
          }
        }
        
        this.userService.removeOnlineUser(userId);
        this.userService.addOnlineUser(userId, socket.id);
        socket.userId = userId;
        socket.sessionId = sessionId;

        await AuthService.updateSession(sessionId, socket.id);

        socket.emit('sessionValid', { userId });
        this.io.emit('userList', this.userService.getAllOnlineUsers());

        this.restoreShareState(socket, userId);
      } else {
        socket.emit('sessionInvalid');
      }
    } catch (error) {
      socket.emit('sessionInvalid');
    }
  }

  async handleRegister(socket, userData) {
    try {
      const { userId, password } = userData;

      await AuthService.register(userId, password);

      // 중복 로그인 방지
      const existingUser = this.userService.getOnlineUser(userId);
      if (existingUser && existingUser.socketId !== socket.id) {
        const existingSocket = this.io.sockets.sockets.get(existingUser.socketId);
        if (existingSocket) {
          existingSocket.emit('forceLogout', { reason: '다른 기기에서 로그인되었습니다' });
          setTimeout(() => existingSocket.disconnect(true), 100);
        }
      }

      this.userService.removeOnlineUser(userId);
      this.userService.addOnlineUser(userId, socket.id);
      socket.userId = userId;

      const sessionId = await AuthService.createSession(userId, socket.id);
      socket.sessionId = sessionId;

      socket.emit('registerSuccess', { userId, sessionId });
      this.io.emit('userList', this.userService.getAllOnlineUsers());
    } catch (error) {
      socket.emit('registerError', { message: error.message });
    }
  }

  async handleLogin(socket, userData) {
    try {
      const { userId, password } = userData;

      await AuthService.login(userId, password);

      // 중복 로그인 방지
      const existingUser = this.userService.getOnlineUser(userId);
      if (existingUser && existingUser.socketId !== socket.id) {
        const existingSocket = this.io.sockets.sockets.get(existingUser.socketId);
        if (existingSocket) {
          existingSocket.emit('forceLogout', { reason: '다른 기기에서 로그인되었습니다' });
          setTimeout(() => existingSocket.disconnect(true), 100);
        }
        await AuthService.deleteSessionByUserId(userId);
      }

      this.userService.removeOnlineUser(userId);
      this.userService.addOnlineUser(userId, socket.id);
      socket.userId = userId;

      const sessionId = await AuthService.createSession(userId, socket.id);
      socket.sessionId = sessionId;

      socket.emit('loginSuccess', { userId, sessionId });
      this.io.emit('userList', this.userService.getAllOnlineUsers());

      this.restoreShareState(socket, userId);
    } catch (error) {
      socket.emit('loginError', { message: error.message });
    }
  }

  async handleLogout(socket, data) {
    const { userId } = data;
    const user = this.userService.getOnlineUser(userId);

    if (user) {
      this.userService.setUserTracking(userId, false);
      this.userService.removeOnlineUser(userId);

      if (socket.sessionId) {
        await AuthService.deleteSession(socket.sessionId);
      }

      this.io.emit('userList', this.userService.getAllOnlineUsers());
    }
  }
}

module.exports = AuthController;
