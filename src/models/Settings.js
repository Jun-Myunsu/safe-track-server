const pool = require('../config/database');

class Settings {
  static async get(key) {
    try {
      const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
      return result.rows[0]?.value || null;
    } catch (error) {
      console.error('설정 조회 실패:', error);
      return null;
    }
  }

  static async set(key, value) {
    try {
      await pool.query(
        'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP',
        [key, value]
      );
      return true;
    } catch (error) {
      console.error('설정 저장 실패:', error);
      return false;
    }
  }

  static async isRegistrationEnabled() {
    const value = await this.get('registration_enabled');
    return value === 'true';
  }

  static async setRegistrationEnabled(enabled) {
    return this.set('registration_enabled', enabled ? 'true' : 'false');
  }
}

module.exports = Settings;
