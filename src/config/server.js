module.exports = {
  port: process.env.PORT || 3000,
  cors: {
    origin: [
      "https://safe-track-client.vercel.app", 
      "http://localhost:3001"
    ],
    methods: ["GET", "POST"]
  },
  session: {
    expiryHours: 24 * 7, // 7 days
    cleanupInterval: 60 * 60 * 1000 // 1 hour
  }
};