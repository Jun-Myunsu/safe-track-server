const User = require('../models/User');
const Session = require('../models/Session');

class AuthService {
  static async register(userId, password) {
    if (!userId || !password) {
      throw new Error('아이디와 비밀번호를 입력하세요');
    }

    if (userId.length < 4) {
      throw new Error('아이디는 4자리 이상 입력하세요');
    }

    if (password.length < 4) {
      throw new Error('비밀번호는 4자리 이상 입력하세요');
    }

    const exists = await User.exists(userId);
    if (exists) {
      throw new Error('이미 사용 중인 아이디입니다');
    }

    const success = await User.create(userId, password);
    if (!success) {
      throw new Error('회원가입 중 오류가 발생했습니다');
    }

    return userId;
  }

  static async login(userId, password) {
    if (!userId || !password) {
      throw new Error('아이디와 비밀번호를 입력하세요');
    }

    if (userId.length < 4) {
      throw new Error('아이디는 4자리 이상이어야 합니다');
    }

    if (password.length < 4) {
      throw new Error('비밀번호는 4자리 이상이어야 합니다');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('존재하지 않는 사용자입니다');
    }

    const isValid = await User.validatePassword(userId, password);
    if (!isValid) {
      throw new Error('비밀번호가 일치하지 않습니다');
    }

    return userId;
  }

  static async createSession(userId, socketId) {
    return Session.create(userId, socketId);
  }

  static async validateSession(sessionId) {
    return Session.findById(sessionId);
  }

  static async updateSession(sessionId, socketId) {
    return Session.update(sessionId, socketId);
  }

  static async deleteSession(sessionId) {
    return Session.delete(sessionId);
  }
}

module.exports = AuthService;