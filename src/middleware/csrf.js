const crypto = require('crypto');

const csrfTokens = new Map();

const generateCsrfToken = (sessionId) => {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(sessionId, token);
  setTimeout(() => csrfTokens.delete(sessionId), 3600000);
  return token;
};

const validateCsrfToken = (req, res, next) => {
  const token = req.headers['x-csrf-token'];
  const sessionId = req.headers['x-session-id'];
  
  if (!token || !sessionId) {
    return res.status(403).json({ error: 'CSRF token required' });
  }
  
  const validToken = csrfTokens.get(sessionId);
  if (!validToken || validToken !== token) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  
  next();
};

module.exports = { validateCsrfToken, generateCsrfToken };
