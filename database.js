const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// PostgreSQL 연결 설정
const pool = new Pool({
  host: process.env.DB_HOST || 'dpg-d3jt4jndiees738od2gg-a.singapore-postgres.render.com',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'safetrack',
  user: process.env.DB_USER || 'safetrack_user',
  password: process.env.DB_PASSWORD || 'YywobJmdfIcaysvYQvkxJl7iqfHjf1a3',
  ssl: { rejectUnauthorized: false }
});

// 데이터베이스 초기화
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

// 사용자 생성
async function createUser(userId, password) {
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

// 사용자 조회
async function getUser(userId) {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('사용자 조회 실패:', error);
    return null;
  }
}

// 사용자 검색
async function searchUsers(query) {
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

// 사용자 존재 확인
async function userExists(userId) {
  try {
    const result = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('사용자 존재 확인 실패:', error);
    return false;
  }
}

// 친구 추가
async function addFriend(userId, friendId) {
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

// 친구 목록 조회
async function getFriends(userId) {
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

// 친구 삭제
async function removeFriend(userId, friendId) {
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

// 세션 생성
async function createSession(userId, socketId = null) {
  try {
    const sessionId = require('crypto').randomBytes(32).toString('hex');
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

// 세션 조회
async function getSession(sessionId) {
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

// 세션 업데이트 (소켓 ID)
async function updateSession(sessionId, socketId) {
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

// 세션 삭제
async function deleteSession(sessionId) {
  try {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    return true;
  } catch (error) {
    console.error('세션 삭제 실패:', error);
    return false;
  }
}

// 만료된 세션 정리
async function cleanExpiredSessions() {
  try {
    await pool.query('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP');
  } catch (error) {
    console.error('만료된 세션 정리 실패:', error);
  }
}

module.exports = {
  initDatabase,
  createUser,
  getUser,
  searchUsers,
  userExists,
  addFriend,
  getFriends,
  removeFriend,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  cleanExpiredSessions,
  pool
};