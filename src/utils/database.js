const bcrypt = require('bcrypt');
const pool = require('../config/database');

async function initDatabase() {
  try {
    // users 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
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

    // 기본 테스트 계정 생성
    const defaultUsers = [
      { id: 'test1', password: 'test1' },
      { id: 'test2', password: 'test2' },
      { id: 'user1', password: 'user1' }
    ];

    for (const user of defaultUsers) {
      const existingUser = await pool.query('SELECT id FROM users WHERE id = $1', [user.id]);
      if (existingUser.rows.length === 0) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        await pool.query(
          'INSERT INTO users (id, password) VALUES ($1, $2)',
          [user.id, hashedPassword]
        );
        console.log(`기본 계정 생성: ${user.id}`);
      }
    }

    console.log('데이터베이스 초기화 완료');
  } catch (error) {
    console.error('데이터베이스 초기화 실패:', error);
  }
}

module.exports = { initDatabase };