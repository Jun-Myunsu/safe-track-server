class LocationService {
  constructor() {
    this.locations = new Map();
    this.locationHistory = new Map();
    this.sharePermissions = new Map();
    this.shareRequests = new Map();
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
    
    // from -> to 권한 추가 (공유하는 사람)
    if (!this.sharePermissions.has(request.from)) {
      this.sharePermissions.set(request.from, new Set());
    }
    this.sharePermissions.get(request.from).add(request.to);
    
    // to -> from 권한 추가 (공유받는 사람도 메시지 보낼 수 있도록)
    if (!this.sharePermissions.has(request.to)) {
      this.sharePermissions.set(request.to, new Set());
    }
    this.sharePermissions.get(request.to).add(request.from);
    
    return request;
  }

  rejectShareRequest(requestId) {
    const request = this.shareRequests.get(requestId);
    if (!request) return false;

    request.status = 'rejected';
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
    
    // to -> from 권한 제거
    if (this.sharePermissions.has(targetUserId)) {
      this.sharePermissions.get(targetUserId).delete(fromUserId);
      if (this.sharePermissions.get(targetUserId).size === 0) {
        this.sharePermissions.delete(targetUserId);
      }
    }
  }

  getAllowedUsers(userId) {
    const allowedUsers = this.sharePermissions.get(userId) || new Set();
    return new Set([userId, ...allowedUsers]);
  }
}

module.exports = LocationService;