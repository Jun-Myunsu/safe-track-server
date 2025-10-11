const AuthService = require('../services/AuthService');

class AuthController {
  constructor(userService, io) {
    this.userService = userService;
    this.io = io;
  }

  async handleValidateSession(socket, data) {
    try {
      const { sessionId } = data;
      const session = await AuthService.validateSession(sessionId);
      
      if (session) {
        const userId = session.user_id;
        this.userService.addOnlineUser(userId, socket.id);
        socket.userId = userId;
        socket.sessionId = sessionId;
        
        await AuthService.updateSession(sessionId, socket.id);
        
        socket.emit('sessionValid', { userId });
        this.io.emit('userList', this.userService.getAllOnlineUsers());
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
      
      // 기존 세션 정리
      this.userService.removeOnlineUser(userId);
      
      this.userService.addOnlineUser(userId, socket.id);
      socket.userId = userId;
      
      const sessionId = await AuthService.createSession(userId, socket.id);
      socket.sessionId = sessionId;
      
      socket.emit('loginSuccess', { userId, sessionId });
      this.io.emit('userList', this.userService.getAllOnlineUsers());
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