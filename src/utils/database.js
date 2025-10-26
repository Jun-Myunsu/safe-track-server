const bcrypt = require("bcrypt");
const pool = require("../config/database");

async function initDatabase() {
  try {
    // users 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        password VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 기존 users 테이블에 is_admin 커럼 추가 (이미 있으면 무시)
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE
    `);

    // msjun을 관리자로 설정
    await pool.query(`
      UPDATE users SET is_admin = TRUE WHERE id = 'msjun'
    `);

    // friends 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        friend_id VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, friend_id)
      )
    `);

    // sessions 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        socket_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // settings 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 기본 설정 추가
    // await pool.query(`
    //   INSERT INTO settings (key, value) VALUES ('registration_enabled', 'true')
    //   ON CONFLICT (key) DO NOTHING
    // `);

    console.log("데이터베이스 초기화 완료");
  } catch (error) {
    console.error("데이터베이스 초기화 실패:", error);
  }
}

module.exports = { initDatabase };
