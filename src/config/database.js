const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'dpg-d3jt4jndiees738od2gg-a.singapore-postgres.render.com',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'safetrack',
  user: process.env.DB_USER || 'safetrack_user',
  password: process.env.DB_PASSWORD || 'YywobJmdfIcaysvYQvkxJl7iqfHjf1a3',
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;