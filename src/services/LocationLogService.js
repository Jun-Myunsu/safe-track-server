const LocationLog = require("../models/LocationLog");

class LocationLogService {
  constructor(io) {
    this.io = io;
    this.trackingIntervals = new Map();
    this.checkInterval = null;
  }

  startTracking(userId, getCurrentLocation) {
    if (this.trackingIntervals.has(userId)) {
      return;
    }

    // 추적 시작 시 즉시 로그 저장
    const logLocation = async () => {
      const location = getCurrentLocation();
      if (location && location.lat && location.lng) {
        try {
          await LocationLog.addLog(userId, location.lat, location.lng);
          console.log(`위치 로그 저장: ${userId} (${location.lat}, ${location.lng})`);
        } catch (error) {
          console.error(`위치 로그 저장 실패 (${userId}):`, error);
        }
      }
    };

    logLocation(); // 즉시 실행

    const interval = setInterval(logLocation, 30000); // 30초마다 실행

    this.trackingIntervals.set(userId, interval);
  }

  async stopTracking(userId) {
    const interval = this.trackingIntervals.get(userId);
    if (interval) {
      clearInterval(interval);
      this.trackingIntervals.delete(userId);
      
      try {
        await LocationLog.deleteUserLogs(userId);
        await LocationLog.deleteStuckUser(userId);
        console.log(`위치 로그 삭제: ${userId}`);
      } catch (error) {
        console.error(`위치 로그 삭제 실패 (${userId}):`, error);
      }
    }
  }

  async checkStuckUsers() {
    try {
      const stuckUsers = await LocationLog.checkAndSaveStuckUsers();
      
      if (stuckUsers.length > 0) {
        console.log(`\n⚠️ ${stuckUsers.length}명의 사용자가 30분 동안 움직이지 않음 (DB 저장):`);
        stuckUsers.forEach((user) => {
          console.log(`- ${user.user_id}: ${user.stuck_duration_seconds}초 동안 정지 (${user.latitude}, ${user.longitude})`);
        });
      }
    } catch (error) {
      console.error("정체 사용자 확인 실패:", error);
    }
  }

  startStuckUserCheck() {
    if (this.checkInterval) return;
    
    this.checkInterval = setInterval(() => {
      this.checkStuckUsers();
    }, 600000);
  }

  stopStuckUserCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

module.exports = LocationLogService;
