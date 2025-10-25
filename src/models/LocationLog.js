const pool = require("../config/database");

class LocationLog {
  static async createTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS location_logs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_location_logs_user_id ON location_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_location_logs_created_at ON location_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_location_logs_user_created ON location_logs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS stuck_users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        stuck_duration_seconds INTEGER NOT NULL,
        first_detected_at TIMESTAMP NOT NULL,
        last_detected_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_stuck_users_user_id ON stuck_users(user_id);
      CREATE INDEX IF NOT EXISTS idx_stuck_users_created_at ON stuck_users(created_at DESC);
    `;
    await pool.query(query);
  }

  static async addLog(userId, latitude, longitude) {
    const query = `
      INSERT INTO location_logs (user_id, latitude, longitude)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [userId, latitude, longitude]);
    return result.rows[0];
  }

  static async deleteUserLogs(userId) {
    const query = `DELETE FROM location_logs WHERE user_id = $1`;
    await pool.query(query, [userId]);
  }

  static async checkAndSaveStuckUsers() {
    const query = `
      WITH recent_logs AS (
        SELECT 
          user_id,
          latitude,
          longitude,
          created_at
        FROM location_logs
        WHERE created_at >= NOW() - INTERVAL '35 minutes'
      ),
      stuck_check AS (
        SELECT 
          user_id,
          MIN(created_at) as first_log,
          MAX(created_at) as last_log,
          MAX(latitude) as latitude,
          MAX(longitude) as longitude,
          COUNT(DISTINCT (latitude::text || ',' || longitude::text)) as unique_locations,
          EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) as duration_seconds
        FROM recent_logs
        GROUP BY user_id
        HAVING 
          COUNT(*) >= 2 
          AND COUNT(DISTINCT (latitude::text || ',' || longitude::text)) = 1
          AND EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) >= 1800
      )
      INSERT INTO stuck_users (user_id, latitude, longitude, stuck_duration_seconds, first_detected_at, last_detected_at)
      SELECT 
        user_id,
        latitude,
        longitude,
        duration_seconds::INTEGER,
        first_log,
        last_log
      FROM stuck_check
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        stuck_duration_seconds = EXTRACT(EPOCH FROM (EXCLUDED.last_detected_at - stuck_users.first_detected_at))::INTEGER,
        last_detected_at = EXCLUDED.last_detected_at,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  static async deleteStuckUser(userId) {
    const query = `DELETE FROM stuck_users WHERE user_id = $1`;
    await pool.query(query, [userId]);
  }

  static async getAllStuckUsers() {
    const query = `
      SELECT * FROM stuck_users 
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }
}

module.exports = LocationLog;
