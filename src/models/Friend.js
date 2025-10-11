const pool = require('../config/database');

class Friend {
  static async add(userId, friendId) {
    try {
      await pool.query(
        'INSERT INTO friends (user_id, friend_id) VALUES ($1, $2)',
        [userId, friendId]
      );
      return true;
    } catch (error) {
      console.error('친구 추가 실패:', error);
      return false;
    }
  }

  static async getList(userId) {
    try {
      const result = await pool.query(
        'SELECT friend_id FROM friends WHERE user_id = $1',
        [userId]
      );
      return result.rows.map(row => ({
        id: row.friend_id,
        name: row.friend_id,
        isOnline: false,
        isTracking: false
      }));
    } catch (error) {
      console.error('친구 목록 조회 실패:', error);
      return [];
    }
  }

  static async remove(userId, friendId) {
    try {
      await pool.query(
        'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2',
        [userId, friendId]
      );
      return true;
    } catch (error) {
      console.error('친구 삭제 실패:', error);
      return false;
    }
  }
}

module.exports = Friend;