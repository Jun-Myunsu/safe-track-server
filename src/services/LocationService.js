class LocationService {
  constructor() {
    this.locations = new Map();
    this.locationHistory = new Map();
    this.sharePermissions = new Map();
    this.shareRequests = new Map();

    // 주기적으로 오래된 요청 정리 (1시간마다)
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldRequests();
    }, 60 * 60 * 1000); // 1시간
  }

  /**
   * 1시간 이상 경과한 요청 제거 (메모리 누수 방지)
   */
  cleanupOldRequests() {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1시간

    let removedCount = 0;
    for (const [requestId, request] of this.shareRequests.entries()) {
      // requestId 형식: userId_targetUserId_timestamp
      const timestamp = parseInt(requestId.split('_')[2]);
      if (now - timestamp > maxAge) {
        this.shareRequests.delete(requestId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`✅ 오래된 공유 요청 ${removedCount}개 정리됨`);
    }
  }

  updateLocation(userId, lat, lng) {
    const timestamp = new Date().toISOString();
    const locationData = { lat, lng, timestamp };
    
    this.locations.set(userId, locationData);
    
    if (!this.locationHistory.has(userId)) {
      this.locationHistory.set(userId, []);
    }
    
    const history = this.locationHistory.get(userId);
    history.push(locationData);
    if (history.length > 50) {
      history.shift();
    }
    
    return { locationData, history };
  }

  getLocation(userId) {
    return this.locations.get(userId);
  }

  getLocationHistory(userId) {
    return this.locationHistory.get(userId) || [];
  }

  removeLocation(userId) {
    this.locations.delete(userId);
    this.locationHistory.delete(userId);
  }

  createShareRequest(fromUserId, targetUserId) {
    const requestId = `${fromUserId}_${targetUserId}_${Date.now()}`;
    
    this.shareRequests.set(requestId, {
      from: fromUserId,
      to: targetUserId,
      status: 'pending'
    });
    
    return requestId;
  }

  getShareRequest(requestId) {
    return this.shareRequests.get(requestId);
  }

  acceptShareRequest(requestId) {
    const request = this.shareRequests.get(requestId);
    if (!request) return false;

    request.status = 'accepted';

    // from -> to 권한만 추가 (공유하는 사람만 위치 전송)
    if (!this.sharePermissions.has(request.from)) {
      this.sharePermissions.set(request.from, new Set());
    }
    this.sharePermissions.get(request.from).add(request.to);

    // 양방향 권한은 명시적 요청 시에만 부여
    // 채팅 기능은 별도 권한으로 관리하는 것이 안전

    // 처리된 요청 제거 (메모리 누수 방지)
    this.shareRequests.delete(requestId);

    return request;
  }

  rejectShareRequest(requestId) {
    const request = this.shareRequests.get(requestId);
    if (!request) return false;

    request.status = 'rejected';

    // 처리된 요청 제거 (메모리 누수 방지)
    this.shareRequests.delete(requestId);

    return request;
  }

  getSharedUsers(userId) {
    return this.sharePermissions.get(userId) || new Set();
  }

  stopLocationShare(fromUserId, targetUserId) {
    // from -> to 권한 제거
    if (this.sharePermissions.has(fromUserId)) {
      this.sharePermissions.get(fromUserId).delete(targetUserId);
      if (this.sharePermissions.get(fromUserId).size === 0) {
        this.sharePermissions.delete(fromUserId);
      }
    }

    // 단방향 공유이므로 반대 방향 권한 제거는 불필요
    // 양방향 공유가 필요한 경우 별도 요청으로 처리
  }

  getAllowedUsers(userId) {
    const allowedUsers = this.sharePermissions.get(userId) || new Set();
    return new Set([userId, ...allowedUsers]);
  }

  getSharingStatus(userId) {
    const sharedWith = Array.from(this.sharePermissions.get(userId) || []);
    const receivedFrom = [];
    
    for (const [fromUser, targets] of this.sharePermissions.entries()) {
      if (targets.has(userId)) {
        receivedFrom.push(fromUser);
      }
    }
    
    return sharedWith.length > 0 || receivedFrom.length > 0
      ? { sharedWith, receivedFrom }
      : null;
  }
}

module.exports = LocationService;