const User = require('../models/User');

class LocationController {
  constructor(userService, locationService, io) {
    this.userService = userService;
    this.locationService = locationService;
    this.io = io;
  }

  handleStartTracking(socket, data) {
    const { userId } = data;
    const user = this.userService.getOnlineUser(userId);
    
    if (!user) {
      socket.emit('trackingError', { message: '사용자를 찾을 수 없습니다' });
      return;
    }
    
    this.userService.setUserTracking(userId, true);
    socket.emit('trackingStarted', { userId });
    this.io.emit('trackingStatusUpdate', { userId, isTracking: true });
    
    console.log(`위치 추적 시작: ${userId}`);
  }

  handleLocationUpdate(socket, data) {
    const { userId, lat, lng } = data;
    const user = this.userService.getOnlineUser(userId);
    
    // 추적 중인 사용자만 위치 업데이트 허용
    if (!user || !user.isTracking) {
      socket.emit('locationUpdateError', { message: '위치 추적이 비활성화되어 있습니다' });
      return;
    }
    
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
    const user = this.userService.getOnlineUser(userId);
    
    if (!user) {
      socket.emit('trackingError', { message: '사용자를 찾을 수 없습니다' });
      return;
    }
    
    this.userService.setUserTracking(userId, false);
    this.locationService.removeLocation(userId);
    socket.emit('trackingStopped', { userId });
    this.io.emit('trackingStatusUpdate', { userId, isTracking: false });
    
    console.log(`위치 추적 중지: ${userId}`);
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
      
      // 상대방이 이미 다른 사람과 공유 중인지 확인
      const targetSharedUsers = this.locationService.getSharedUsers(targetUserId);
      if (targetSharedUsers.size > 0) {
        socket.emit('shareRequestError', { message: `${targetUserId}님이 다른 사용자와 공유 중입니다`, targetUserId });
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
    const request = this.locationService.getShareRequest(requestId);
    
    if (!request) {
      socket.emit('shareResponseError', { message: '요청을 찾을 수 없습니다' });
      return;
    }
    
    // 수락 시 이미 공유 중인지 확인
    if (accepted) {
      const mySharedUsers = this.locationService.getSharedUsers(request.to);
      if (mySharedUsers.size > 0) {
        socket.emit('shareResponseError', { message: '이미 다른 사용자와 공유 중입니다' });
        
        // 요청자에게 거절 알림
        const fromUser = this.userService.getOnlineUser(request.from);
        if (fromUser) {
          this.io.to(fromUser.socketId).emit('locationShareResponse', {
            requestId,
            accepted: false,
            targetUserId: request.to,
            targetName: this.userService.getOnlineUser(request.to).name,
            reason: 'busy'
          });
        }
        return;
      }
      
      this.locationService.acceptShareRequest(requestId);
    } else {
      this.locationService.rejectShareRequest(requestId);
    }
    
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

  handleStopLocationShare(socket, data) {
    const { targetUserId } = data;
    const fromUserId = socket.userId;

    this.locationService.stopLocationShare(fromUserId, targetUserId);

    // 다른 공유 중인 사용자가 있는지 확인
    const sharedUsers = this.locationService.getSharedUsers(fromUserId);
    const hasOtherShares = sharedUsers.size > 0;

    // 다른 공유가 없을 때만 추적 중단
    if (!hasOtherShares) {
      this.userService.setUserTracking(fromUserId, false);
      this.locationService.removeLocation(fromUserId);
      this.io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    }

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

    // 다른 공유 중인 사용자가 있는지 확인
    const sharedUsers = this.locationService.getSharedUsers(fromUserId);
    const hasOtherShares = sharedUsers.size > 0;

    // 다른 공유가 없을 때만 추적 중단
    if (!hasOtherShares) {
      this.userService.setUserTracking(fromUserId, false);
      this.locationService.removeLocation(fromUserId);
      this.io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    }

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