require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const config = require('./config/server');
const { initDatabase } = require('./utils/database');
const Session = require('./models/Session');
const { configureExpressMiddleware } = require('./middleware/expressConfig');
const { SERVER_URLS, LOG_MESSAGES } = require('./constants/app');

// Services
const UserService = require('./services/UserService');
const LocationService = require('./services/LocationService');
const ChatService = require('./services/ChatService');
const KeepAliveService = require('./services/KeepAliveService');
const AIChatService = require('./services/AIChatService');
const DangerPredictionService = require('./services/DangerPredictionService');

// Controllers
const AuthController = require('./controllers/AuthController');
const LocationController = require('./controllers/LocationController');
const UserController = require('./controllers/UserController');
const ChatController = require('./controllers/ChatController');
const AIChatController = require('./controllers/AIChatController');
const SettingsController = require('./controllers/SettingsController');
const DangerPredictionController = require('./controllers/DangerPredictionController');

// Socket Handler
const SocketEventHandler = require('./socket/SocketEventHandler');

/**
 * Safe Track 서버 애플리케이션
 * Express와 Socket.IO를 사용한 실시간 위치 공유 서버
 */
class SafeTrackServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, { cors: config.cors });

    this.initializeMiddleware();
    this.setupRoutes();
    this.initializeServices();
    this.initializeControllers();
    this.setupSocketIO();
    this.startBackgroundTasks();
  }

  /**
   * Express 미들웨어 초기화
   */
  initializeMiddleware() {
    configureExpressMiddleware(this.app);
  }

  /**
   * HTTP 라우트 설정
   */
  setupRoutes() {
    this.app.get('/ping', (_req, res) => {
      res.json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        onlineUsers: this.userService ? this.userService.getOnlineUserCount() : 0
      });
    });

    this.app.post('/api/emergency-tip', async (_req, res) => {
      try {
        const tip = await this.aiChatService.generateEmergencyTip();
        res.json(tip);
      } catch (error) {
        console.error('응급 상식 생성 실패:', error);
        res.status(500).json({ error: '응급 상식을 불러올 수 없습니다' });
      }
    });
  }

  /**
   * 서비스 레이어 초기화
   */
  initializeServices() {
    this.userService = new UserService();
    this.locationService = new LocationService();
    this.chatService = new ChatService(this.locationService, this.userService);
    this.aiChatService = new AIChatService();
    this.dangerPredictionService = new DangerPredictionService();

    // Keep-alive 서비스 초기화
    const serverUrl = process.env.RENDER_EXTERNAL_URL || SERVER_URLS.DEFAULT_RENDER_URL;
    this.keepAliveService = new KeepAliveService(serverUrl, 5);
  }

  /**
   * 컨트롤러 레이어 초기화
   */
  initializeControllers() {
    this.authController = new AuthController(this.userService, this.locationService, this.io);
    this.locationController = new LocationController(
      this.userService,
      this.locationService,
      this.io
    );
    this.userController = new UserController(this.userService, this.io);
    this.chatController = new ChatController(
      this.chatService,
      this.userService,
      this.io
    );
    this.aiChatController = new AIChatController(this.aiChatService, this.userService, this.io);
    this.settingsController = new SettingsController();
    this.dangerPredictionController = new DangerPredictionController(this.dangerPredictionService);

    // HTTP 라우트 설정
    this.dangerPredictionController.setupRoutes(this.app);
  }

  /**
   * Socket.IO 이벤트 핸들러 설정
   */
  setupSocketIO() {
    const controllers = {
      authController: this.authController,
      locationController: this.locationController,
      userController: this.userController,
      aiChatController: this.aiChatController,
      chatController: this.chatController,
      settingsController: this.settingsController,
    };

    const services = {
      userService: this.userService,
      locationService: this.locationService,
      chatService: this.chatService,
      aiChatService: this.aiChatService,
    };

    this.socketEventHandler = new SocketEventHandler(this.io, controllers, services);
    this.socketEventHandler.initialize();
  }

  /**
   * 백그라운드 작업 시작
   */
  startBackgroundTasks() {
    this.startSessionCleanup();
    this.keepAliveService.start();
  }

  /**
   * 만료된 세션 정리 작업 시작
   */
  startSessionCleanup() {
    setInterval(() => {
      Session.cleanExpired();
    }, config.session.cleanupInterval);
  }

  /**
   * 서버 시작
   */
  async start() {
    await initDatabase();

    this.server.listen(config.port, '0.0.0.0', () => {
      console.log(`${LOG_MESSAGES.SERVER_STARTED} ${config.port}`);
    });
  }

  /**
   * 서버 종료 (Graceful shutdown)
   */
  async shutdown() {
    console.log('서버 종료 시작...');

    this.keepAliveService.stop();

    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('서버가 안전하게 종료되었습니다.');
        resolve();
      });
    });
  }
}

module.exports = SafeTrackServer;
