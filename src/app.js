require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const config = require("./config/server");
const { initDatabase } = require("./utils/database");
const Session = require("./models/Session");
const LocationLog = require("./models/LocationLog");
const { configureExpressMiddleware } = require("./middleware/expressConfig");
const { validateCsrfToken } = require("./middleware/csrf");
const { SERVER_URLS, LOG_MESSAGES } = require("./constants/app");

// Services
const UserService = require("./services/UserService");
const LocationService = require("./services/LocationService");
const ChatService = require("./services/ChatService");
const KeepAliveService = require("./services/KeepAliveService");
const AIChatService = require("./services/AIChatService");
const DangerPredictionService = require("./services/DangerPredictionService");
const LocationLogService = require("./services/LocationLogService");

// Controllers
const AuthController = require("./controllers/AuthController");
const LocationController = require("./controllers/LocationController");
const UserController = require("./controllers/UserController");
const ChatController = require("./controllers/ChatController");
const AIChatController = require("./controllers/AIChatController");
const SettingsController = require("./controllers/SettingsController");
const DangerPredictionController = require("./controllers/DangerPredictionController");

// Socket Handler
const SocketEventHandler = require("./socket/SocketEventHandler");

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
    this.initializeServices();
    this.setupRoutes();
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
    this.app.get("/ping", (_req, res) => {
      res.json({
        status: "alive",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        onlineUsers: this.userService
          ? this.userService.getOnlineUserCount()
          : 0,
      });
    });



    this.app.post("/api/emergency-tip", async (_req, res) => {
      try {
        const tip = await this.aiChatService.generateEmergencyTip();
        res.json(tip);
      } catch (error) {
        console.error("응급 상식 생성 실패:", error.message || error);
        res.status(500).json({
          error: "응급 상식을 불러올 수 없습니다",
          title: "긴급 연락처",
          content:
            "응급상황 시 112(경찰), 119(소방/구급), 1366(여성 긴급전화)로 연락하세요.",
        });
      }
    });

    this.app.get("/api/admin/stuck-users", async (_req, res) => {
      try {
        const stuckUsers = await LocationLog.getAllStuckUsers();
        if (!stuckUsers) {
          return res.json({ success: true, data: [] });
        }
        res.json({ success: true, data: stuckUsers });
      } catch (error) {
        console.error("정체 사용자 조회 실패:", error);
        res.status(500).json({
          success: false,
          error: error.message || "정체 사용자 조회 실패",
          data: [],
        });
      }
    });

    this.app.delete("/api/admin/stuck-users/:userId", async (req, res) => {
      try {
        const userId = req.params.userId;
        if (!userId) {
          return res
            .status(400)
            .json({ success: false, error: "userId가 필요합니다" });
        }
        await LocationLog.deleteStuckUser(userId);
        res.json({ success: true });
      } catch (error) {
        console.error("정체 사용자 삭제 실패:", error.message || error);
        res.status(500).json({
          success: false,
          error: "정체 사용자 삭제 실패",
        });
      }
    });

    this.app.get("/api/cctv", async (req, res) => {
      try {
        const apiKey = process.env.ITS_API_KEY;
        if (!apiKey) {
          return res.status(500).json({ error: "서버에 CCTV API 키가 설정되지 않았습니다" });
        }

        const { minX, maxX, minY, maxY } = req.query;
        if (!minX || !maxX || !minY || !maxY) {
          return res.status(400).json({ error: "지도 영역 파라미터가 필요합니다" });
        }

        const params = new URLSearchParams({
          apiKey,
          type: 'all',
          cctvType: '4',
          minX,
          maxX,
          minY,
          maxY,
          getType: 'json'
        });

        const response = await fetch(`https://openapi.its.go.kr:9443/cctvInfo?${params}`);
        const data = await response.json();
        
        if (data.response && data.response.data) {
          const items = Array.isArray(data.response.data) ? data.response.data : [data.response.data];
          items.forEach(item => item.cctvType = '4');
          console.log(`현재 지도 영역에서 ${items.length}개 CCTV 발견`);
          if (items.length > 0) {
            console.log('CCTV 샘플:', {
              name: items[0].cctvname,
              format: items[0].cctvformat,
              url: items[0].cctvurl?.substring(0, 80)
            });
          }
          res.json({ response: { data: items } });
        } else {
          res.json({ response: { data: [] } });
        }
      } catch (error) {
        console.error("CCTV 데이터 로드 실패:", error.message || error);
        res.status(500).json({ error: "CCTV 데이터 로드 실패" });
      }
    });

    this.app.post("/api/amber", async (req, res) => {
      try {
        const esntlId = process.env.SAFE182_ESNTL_ID;
        const authKey = process.env.SAFE182_AUTH_KEY;
        
        console.log('API 키 확인:', { esntlId: esntlId ? '설정됨' : '없음', authKey: authKey ? '설정됨' : '없음' });
        
        if (!esntlId || !authKey) {
          console.error('API 키 누락:', { esntlId, authKey });
          return res.status(500).json({ error: "서버에 API 키가 설정되지 않았습니다" });
        }
        
        const params = new URLSearchParams();
        params.append("esntlId", esntlId);
        params.append("authKey", authKey);
        
        for (const [k, v] of Object.entries(req.body || {})) {
          if (Array.isArray(v)) v.forEach((vv) => params.append(k, vv));
          else params.append(k, v ?? "");
        }
        
        const response = await fetch("https://www.safe182.go.kr/api/lcm/amberList.do", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: params.toString(),
        });
        const text = await response.text();
        res.type("application/json").send(text);
      } catch (error) {
        console.error("실종자 데이터 로드 실패:", error.message || error);
        res.status(500).json({ error: "실종자 데이터 로드 실패: " + (error.message || error) });
      }
    });
  }

  /**
   * 서비스 레이어 초기화
   */
  initializeServices() {
    try {
      this.userService = new UserService();
      this.locationService = new LocationService();
      this.chatService = new ChatService(
        this.locationService,
        this.userService
      );
      this.aiChatService = new AIChatService();
      this.dangerPredictionService = new DangerPredictionService();
      this.locationLogService = new LocationLogService(this.io);

      // Keep-alive 서비스 초기화
      const serverUrl =
        process.env.RENDER_EXTERNAL_URL || SERVER_URLS.DEFAULT_RENDER_URL;
      this.keepAliveService = new KeepAliveService(serverUrl, 5);
    } catch (error) {
      console.error("서비스 초기화 실패:", error);
      throw error;
    }
  }

  /**
   * 컨트롤러 레이어 초기화
   */
  initializeControllers() {
    this.authController = new AuthController(
      this.userService,
      this.locationService,
      this.io
    );
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
    this.aiChatController = new AIChatController(
      this.aiChatService,
      this.userService,
      this.io
    );
    this.settingsController = new SettingsController();
    this.dangerPredictionController = new DangerPredictionController(
      this.dangerPredictionService
    );

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
      locationLogService: this.locationLogService,
    };

    this.socketEventHandler = new SocketEventHandler(
      this.io,
      controllers,
      services
    );
    this.socketEventHandler.initialize();
  }

  /**
   * 백그라운드 작업 시작
   */
  startBackgroundTasks() {
    try {
      this.startSessionCleanup();
      this.keepAliveService.start();
      this.locationLogService.startStuckUserCheck();
    } catch (error) {
      console.error("백그라운드 작업 시작 실패:", error);
    }
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
    await LocationLog.createTable();

    this.server.listen(config.port, "0.0.0.0", () => {
      console.log(`${LOG_MESSAGES.SERVER_STARTED} ${config.port}`);
    });
  }

  /**
   * 서버 종료 (Graceful shutdown)
   */
  async shutdown() {
    console.log("서버 종료 시작...");

    this.keepAliveService.stop();

    return new Promise((resolve) => {
      this.server.close(() => {
        console.log("서버가 안전하게 종료되었습니다.");
        resolve();
      });
    });
  }
}

module.exports = SafeTrackServer;
