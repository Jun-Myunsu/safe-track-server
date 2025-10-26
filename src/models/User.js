const bcrypt = require('bcrypt');
const pool = require('../config/database');

class User {
  static async create(userId, password) {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        'INSERT INTO users (id, password) VALUES ($1, $2)',
        [userId, hashedPassword]
      );
      return true;
    } catch (error) {
      console.error('사용자 생성 실패:', error);
      return false;
    }
  }

  static async findById(userId) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('사용자 조회 실패:', error);
      return null;
    }
  }

  static async isAdmin(userId) {
    try {
      const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
      return result.rows[0]?.is_admin || false;
    } catch (error) {
      console.error('관리자 확인 실패:', error);
      return false;
    }
  }

  static async search(query) {
    try {
      const result = await pool.query(
        'SELECT id FROM users WHERE id ILIKE $1 ORDER BY id',
        [`%${query}%`]
      );
      return result.rows.map(row => ({
        id: row.id,
        name: row.id,
        isOnline: false,
        isTracking: false
      }));
    } catch (error) {
      console.error('사용자 검색 실패:', error);
      return [];
    }
  }

  static async exists(userId) {
    try {
      const result = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
      return result.rows.length > 0;
    } catch (error) {
      console.error('사용자 존재 확인 실패:', error);
      return false;
    }
  }

  static async validatePassword(userId, password) {
    const user = await this.findById(userId);
    if (!user) return false;
    return bcrypt.compare(password, user.password);
  }
}

module.exports = User;