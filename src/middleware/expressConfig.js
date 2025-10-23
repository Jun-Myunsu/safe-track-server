const express = require('express');
const config = require('../config/server');

/**
 * Express 애플리케이션 미들웨어 설정
 * @param {express.Application} app - Express 앱 인스턴스
 */
function configureExpressMiddleware(app) {
  // JSON 파싱
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS 헤더 설정 (Socket.IO는 별도로 설정됨)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (config.cors.origin.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', config.cors.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // 요청 로깅 (개발 환경)
  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }
}

module.exports = { configureExpressMiddleware };
