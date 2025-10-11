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
    
    if (!this.sharePermissions.has(request.from)) {
      this.sharePermissions.set(request.from, new Set());
    }
    this.sharePermissions.get(request.from).add(request.to);
    
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
    if (this.sharePermissions.has(fromUserId)) {
      this.sharePermissions.get(fromUserId).delete(targetUserId);
      if (this.sharePermissions.get(fromUserId).size === 0) {
        this.sharePermissions.delete(fromUserId);
      }
    }
  }

  getAllowedUsers(userId) {
    const allowedUsers = this.sharePermissions.get(userId) || new Set();
    return new Set([userId, ...allowedUsers]);
  }
}

module.exports = LocationService;