const User = require('../models/User');

class LocationController {
  constructor(userService, locationService, io) {
    this.userService = userService;
    this.locationService = locationService;
    this.io = io;
  }

  handleStartTracking(socket, data) {
    const { userId } = data;
    this.userService.setUserTracking(userId, true);
    this.io.emit('trackingStatusUpdate', { userId, isTracking: true });
  }

  handleLocationUpdate(socket, data) {
    const { userId, lat, lng } = data;
    const { locationData, history } = this.locationService.updateLocation(userId, lat, lng);
    
    const allowedUsers = this.locationService.getAllowedUsers(userId);
    
    allowedUsers.forEach(targetUserId => {
      const targetUser = this.userService.getOnlineUser(targetUserId);
      if (targetUser) {
        this.io.to(targetUser.socketId).emit('locationReceived', { 
          userId, 
          lat, 
          lng, 
          timestamp: locationData.timestamp,
          path: history.map(h => [h.lat, h.lng])
        });
      }
    });
  }

  handleStopTracking(socket, data) {
    const { userId } = data;
    this.userService.setUserTracking(userId, false);
    this.locationService.removeLocation(userId);
    this.io.emit('trackingStatusUpdate', { userId, isTracking: false });
  }

  async handleRequestLocationShare(socket, data) {
    try {
      const { targetUserId } = data;
      const fromUserId = socket.userId;
      
      const targetExists = await User.exists(targetUserId);
      if (!targetExists) {
        socket.emit('shareRequestError', { message: '존재하지 않는 사용자입니다', targetUserId });
        return;
      }
      
      const targetUser = this.userService.getOnlineUser(targetUserId);
      if (!targetUser) {
        socket.emit('shareRequestError', { message: '해당 사용자가 현재 오프라인입니다', targetUserId });
        return;
      }
      
      const requestId = this.locationService.createShareRequest(fromUserId, targetUserId);
      
      this.io.to(targetUser.socketId).emit('locationShareRequest', {
        requestId,
        from: fromUserId,
        fromName: this.userService.getOnlineUser(fromUserId).name
      });
      
      socket.emit('shareRequestSent', { targetUserId, targetName: targetUserId });
    } catch (error) {
      socket.emit('shareRequestError', { message: '요청 처리 중 오류가 발생했습니다', targetUserId: data.targetUserId });
    }
  }

  handleRespondLocationShare(socket, data) {
    const { requestId, accepted } = data;
    
    let request;
    if (accepted) {
      request = this.locationService.acceptShareRequest(requestId);
    } else {
      request = this.locationService.rejectShareRequest(requestId);
    }
    
    if (request) {
      const fromUser = this.userService.getOnlineUser(request.from);
      if (fromUser) {
        this.io.to(fromUser.socketId).emit('locationShareResponse', {
          requestId,
          accepted,
          targetUserId: request.to,
          targetName: this.userService.getOnlineUser(request.to).name
        });
        
        if (accepted) {
          const fromUserLocation = this.locationService.getLocation(request.from);
          const fromUserHistory = this.locationService.getLocationHistory(request.from);
          
          if (fromUserLocation && fromUserHistory.length > 0) {
            const toUser = this.userService.getOnlineUser(request.to);
            if (toUser) {
              this.io.to(toUser.socketId).emit('locationReceived', {
                userId: request.from,
                lat: fromUserLocation.lat,
                lng: fromUserLocation.lng,
                timestamp: fromUserLocation.timestamp,
                path: fromUserHistory.map(h => [h.lat, h.lng])
              });
            }
          }
        }
      }
    }
  }

  handleStopLocationShare(socket, data) {
    const { targetUserId } = data;
    const fromUserId = socket.userId;
    
    this.locationService.stopLocationShare(fromUserId, targetUserId);
    
    // 요청자의 위치 추적 중단
    this.userService.setUserTracking(fromUserId, false);
    this.locationService.removeLocation(fromUserId);
    this.io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    
    const targetUser = this.userService.getOnlineUser(targetUserId);
    if (targetUser) {
      this.io.to(targetUser.socketId).emit('locationShareStopped', {
        fromUserId,
        fromName: this.userService.getOnlineUser(fromUserId).name
      });
      this.io.to(targetUser.socketId).emit('locationRemoved', { userId: fromUserId });
    }
  }

  handleStopReceivingShare(socket, data) {
    const { fromUserId } = data;
    const toUserId = socket.userId;
    
    this.locationService.stopLocationShare(fromUserId, toUserId);
    
    // 요청자의 위치 추적 중단
    this.userService.setUserTracking(fromUserId, false);
    this.locationService.removeLocation(fromUserId);
    this.io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    
    const fromUser = this.userService.getOnlineUser(fromUserId);
    if (fromUser) {
      this.io.to(fromUser.socketId).emit('locationShareStopped', {
        fromUserId: toUserId,
        fromName: this.userService.getOnlineUser(toUserId).name
      });
    }
  }

  handleRequestCurrentLocation(socket, data) {
    const { targetUserId } = data;
    
    const targetLocation = this.locationService.getLocation(targetUserId);
    const targetHistory = this.locationService.getLocationHistory(targetUserId);
    
    if (targetLocation && targetHistory.length > 0) {
      socket.emit('locationReceived', {
        userId: targetUserId,
        lat: targetLocation.lat,
        lng: targetLocation.lng,
        timestamp: targetLocation.timestamp,
        path: targetHistory.map(h => [h.lat, h.lng])
      });
    }
  }
}

module.exports = LocationController;