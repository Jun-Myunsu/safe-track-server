const crypto = require('crypto');
const pool = require('../config/database');

class Session {
  static async create(userId, socketId = null) {
    try {
      const sessionId = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'INSERT INTO sessions (id, user_id, socket_id) VALUES ($1, $2, $3)',
        [sessionId, userId, socketId]
      );
      return sessionId;
    } catch (error) {
      console.error('세션 생성 실패:', error);
      return null;
    }
  }

  static async findById(sessionId) {
    try {
      const result = await pool.query(
        'SELECT * FROM sessions WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP',
        [sessionId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('세션 조회 실패:', error);
      return null;
    }
  }

  static async update(sessionId, socketId) {
    try {
      await pool.query(
        'UPDATE sessions SET socket_id = $1 WHERE id = $2',
        [socketId, sessionId]
      );
      return true;
    } catch (error) {
      console.error('세션 업데이트 실패:', error);
      return false;
    }
  }

  static async delete(sessionId) {
    try {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return true;
    } catch (error) {
      console.error('세션 삭제 실패:', error);
      return false;
    }
  }

  static async deleteByUserId(userId) {
    try {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      return true;
    } catch (error) {
      console.error('사용자 세션 삭제 실패:', error);
      return false;
    }
  }

  static async cleanExpired() {
    try {
      await pool.query('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP');
    } catch (error) {
      console.error('만료된 세션 정리 실패:', error);
    }
  }
}

module.exports = Session;