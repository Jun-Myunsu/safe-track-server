require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const config = require('./config/server');
const { initDatabase } = require('./utils/database');
const Session = require('./models/Session');

// Services
const UserService = require('./services/UserService');
const LocationService = require('./services/LocationService');
const ChatService = require('./services/ChatService');

// Controllers
const AuthController = require('./controllers/AuthController');
const LocationController = require('./controllers/LocationController');
const UserController = require('./controllers/UserController');
const ChatController = require('./controllers/ChatController');

class SafeTrackServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, { cors: config.cors });
    
    this.initServices();
    this.initControllers();
    this.setupSocketHandlers();
    this.startCleanupTasks();
  }

  initServices() {
    this.userService = new UserService();
    this.locationService = new LocationService();
    this.chatService = new ChatService(this.locationService, this.userService);
  }

  initControllers() {
    this.authController = new AuthController(this.userService, this.io);
    this.locationController = new LocationController(this.userService, this.locationService, this.io);
    this.userController = new UserController(this.userService, this.io);
    this.chatController = new ChatController(this.chatService, this.userService, this.io);
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('사용자 연결:', socket.id, '| IP:', socket.handshake.address);
      
      socket.emit('userList', this.userService.getAllOnlineUsers());

      // Auth events
      socket.on('validateSession', (data) => this.authController.handleValidateSession(socket, data));
      socket.on('register', (data) => this.authController.handleRegister(socket, data));
      socket.on('login', (data) => this.authController.handleLogin(socket, data));
      socket.on('logout', (data) => this.authController.handleLogout(socket, data));

      // User events
      socket.on('checkUserId', (data) => this.userController.handleCheckUserId(socket, data));
      socket.on('reconnect', (data) => this.userController.handleReconnect(socket, data));
      socket.on('searchUsers', (data) => this.userController.handleSearchUsers(socket, data));
      socket.on('addFriend', (data) => this.userController.handleAddFriend(socket, data));
      socket.on('getFriends', (data) => this.userController.handleGetFriends(socket, data));
      socket.on('removeFriend', (data) => this.userController.handleRemoveFriend(socket, data));

      // Location events
      socket.on('startTracking', (data) => this.locationController.handleStartTracking(socket, data));
      socket.on('locationUpdate', (data) => this.locationController.handleLocationUpdate(socket, data));
      socket.on('stopTracking', (data) => this.locationController.handleStopTracking(socket, data));
      socket.on('requestLocationShare', (data) => this.locationController.handleRequestLocationShare(socket, data));
      socket.on('respondLocationShare', (data) => this.locationController.handleRespondLocationShare(socket, data));
      socket.on('stopLocationShare', (data) => this.locationController.handleStopLocationShare(socket, data));
      socket.on('stopReceivingShare', (data) => this.locationController.handleStopReceivingShare(socket, data));
      socket.on('requestCurrentLocation', (data) => this.locationController.handleRequestCurrentLocation(socket, data));

      // Chat events
      socket.on('sendMessage', (data) => this.chatController.handleSendMessage(socket, data));

      // Disconnect
      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  handleDisconnect(socket) {
    if (socket.userId) {
      const user = this.userService.getOnlineUser(socket.userId);
      if (user && user.socketId === socket.id) {
        this.userService.setUserTracking(socket.userId, false);
        this.locationService.removeLocation(socket.userId);
        this.userService.removeOnlineUser(socket.userId);
        
        this.io.emit('trackingStatusUpdate', { userId: socket.userId, isTracking: false });
        
        setTimeout(() => {
          this.io.emit('userList', this.userService.getAllOnlineUsers());
        }, 1000);
      }
    }
  }

  startCleanupTasks() {
    setInterval(() => {
      Session.cleanExpired();
    }, config.session.cleanupInterval);
  }

  async start() {
    await initDatabase();
    
    this.server.listen(config.port, '0.0.0.0', () => {
      console.log(`Safe Track Server running on port ${config.port}`);
    });
  }
}

module.exports = SafeTrackServer;