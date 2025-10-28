const User = require('../models/User');

class LocationController {
  constructor(userService, locationService, io) {
    this.userService = userService;
    this.locationService = locationService;
    this.io = io;
  }

  handleStartTracking(socket, data = {}) {
    const socketUserId = socket.userId;
    const requestedUserId = data.userId;

    if (!socketUserId) {
      socket.emit('trackingError', { message: '인증되지 않은 요청입니다.' });
      return;
    }

    if (requestedUserId && requestedUserId !== socketUserId) {
      socket.emit('trackingError', { message: '본인 위치만 추적할 수 있습니다.' });
      return;
    }

    const user = this.userService.getOnlineUser(socketUserId);
    if (!user) {
      socket.emit('trackingError', { message: '사용자를 찾을 수 없습니다.' });
      return;
    }

    this.userService.setUserTracking(socketUserId, true);
    socket.emit('trackingStarted', { userId: socketUserId });
    this.io.emit('trackingStatusUpdate', { userId: socketUserId, isTracking: true });

    console.log(`위치 추적 시작: ${socketUserId}`);
  }

  handleLocationUpdate(socket, data = {}) {
    const socketUserId = socket.userId;
    if (!socketUserId) {
      socket.emit('locationUpdateError', { message: '인증되지 않은 요청입니다.' });
      return;
    }

    const { lat, lng } = data;
    const numericLat = Number(lat);
    const numericLng = Number(lng);

    // 좌표 타입 검증
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
      socket.emit('locationUpdateError', { message: '잘못된 위치 좌표입니다.' });
      return;
    }

    // 좌표 범위 검증 (위도: -90~90, 경도: -180~180)
    if (numericLat < -90 || numericLat > 90) {
      socket.emit('locationUpdateError', { message: '위도는 -90~90 범위여야 합니다.' });
      return;
    }

    if (numericLng < -180 || numericLng > 180) {
      socket.emit('locationUpdateError', { message: '경도는 -180~180 범위여야 합니다.' });
      return;
    }

    const user = this.userService.getOnlineUser(socketUserId);
    if (!user || !user.isTracking) {
      socket.emit('locationUpdateError', { message: '위치 추적이 활성화되어 있지 않습니다.' });
      return;
    }

    const { locationData, history } = this.locationService.updateLocation(
      socketUserId,
      numericLat,
      numericLng
    );

    const allowedUsers = this.locationService.getAllowedUsers(socketUserId);

    allowedUsers.forEach((targetUserId) => {
      try {
        const targetUser = this.userService.getOnlineUser(targetUserId);
        if (targetUser && targetUser.socketId) {
          // 소켓이 여전히 연결되어 있는지 확인
          const targetSocket = this.io.sockets.sockets.get(targetUser.socketId);
          if (targetSocket && targetSocket.connected) {
            this.io.to(targetUser.socketId).emit('locationReceived', {
              userId: socketUserId,
              lat: numericLat,
              lng: numericLng,
              timestamp: locationData.timestamp,
              path: history.map((h) => [h.lat, h.lng])
            });
          } else {
            // 소켓 연결이 끊어진 경우 권한 유지 (재연결 대기)
            console.warn(`소켓 연결 끊어짐: ${targetUserId}, 권한 유지 중`);
          }
        }
      } catch (error) {
        console.error(`위치 전송 실패 (${targetUserId}):`, error);
      }
    });
  }

  handleStopTracking(socket, data = {}) {
    const socketUserId = socket.userId;
    const requestedUserId = data.userId;

    if (!socketUserId) {
      socket.emit('trackingError', { message: '인증되지 않은 요청입니다.' });
      return;
    }

    if (requestedUserId && requestedUserId !== socketUserId) {
      socket.emit('trackingError', { message: '본인 위치만 중단할 수 있습니다.' });
      return;
    }

    const user = this.userService.getOnlineUser(socketUserId);
    if (!user) {
      socket.emit('trackingError', { message: '사용자를 찾을 수 없습니다.' });
      return;
    }

    // 공유 중인 사용자들에게 위치 제거 알림
    const allowedUsers = this.locationService.getAllowedUsers(socketUserId);
    allowedUsers.forEach((targetUserId) => {
      const targetUser = this.userService.getOnlineUser(targetUserId);
      if (targetUser) {
        this.io.to(targetUser.socketId).emit('locationRemoved', { userId: socketUserId });
      }
    });

    this.userService.setUserTracking(socketUserId, false);
    this.locationService.removeLocation(socketUserId);
    socket.emit('trackingStopped', { userId: socketUserId });
    this.io.emit('trackingStatusUpdate', { userId: socketUserId, isTracking: false });

    console.log(`위치 추적 종료: ${socketUserId}`);
  }

  async handleRequestLocationShare(socket, data = {}) {
    try {
      const { targetUserId } = data;
      const fromUserId = socket.userId;

      if (!fromUserId || !targetUserId) {
        socket.emit('shareRequestError', { message: '잘못된 요청입니다.', targetUserId });
        return;
      }

      const targetExists = await User.exists(targetUserId);
      if (!targetExists) {
        socket.emit('shareRequestError', { message: '존재하지 않는 사용자입니다.', targetUserId });
        return;
      }

      const targetUser = this.userService.getOnlineUser(targetUserId);
      if (!targetUser) {
        socket.emit('shareRequestError', { message: '상대 사용자가 오프라인입니다.', targetUserId });
        return;
      }

      // 상대가 이미 다른 사용자와 공유 중인지 확인
      const targetSharedUsers = this.locationService.getSharedUsers(targetUserId);
      if (targetSharedUsers.size > 0) {
        socket.emit('shareRequestError', {
          message: `${targetUserId}님은 이미 다른 사용자와 공유 중입니다.`,
          targetUserId
        });
        return;
      }

      const requestId = this.locationService.createShareRequest(fromUserId, targetUserId);

      this.io.to(targetUser.socketId).emit('locationShareRequest', {
        requestId,
        from: fromUserId,
        fromName: this.userService.getOnlineUser(fromUserId)?.name || fromUserId
      });

      socket.emit('shareRequestSent', { targetUserId, targetName: targetUserId });
    } catch (error) {
      socket.emit('shareRequestError', {
        message: '요청 처리 중 문제가 발생했습니다.',
        targetUserId: data.targetUserId
      });
    }
  }

  handleRespondLocationShare(socket, data) {
    const { requestId, accepted } = data;
    const request = this.locationService.getShareRequest(requestId);

    if (!request) {
      socket.emit('shareResponseError', { message: '요청을 찾을 수 없습니다.' });
      return;
    }

    if (accepted) {
      const mySharedUsers = this.locationService.getSharedUsers(request.to);
      if (mySharedUsers.size > 0) {
        socket.emit('shareResponseError', { message: '이미 다른 사용자와 공유 중입니다.' });

        const fromUser = this.userService.getOnlineUser(request.from);
        if (fromUser) {
          this.io.to(fromUser.socketId).emit('locationShareResponse', {
            requestId,
            accepted: false,
            targetUserId: request.to,
            targetName: this.userService.getOnlineUser(request.to)?.name || request.to,
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
        targetName: this.userService.getOnlineUser(request.to)?.name || request.to
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
              path: fromUserHistory.map((h) => [h.lat, h.lng])
            });
          }
        }
      }
    }
  }

  handleStopLocationShare(socket, data) {
    const { targetUserId } = data;
    const fromUserId = socket.userId;

    if (!fromUserId || !targetUserId) {
      socket.emit('shareRequestError', { message: '잘못된 요청입니다.' });
      return;
    }

    this.locationService.stopLocationShare(fromUserId, targetUserId);

    const sharedUsers = this.locationService.getSharedUsers(fromUserId);
    const hasOtherShares = sharedUsers.size > 0;

    if (!hasOtherShares) {
      this.userService.setUserTracking(fromUserId, false);
      this.locationService.removeLocation(fromUserId);
      this.io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    }

    const targetUser = this.userService.getOnlineUser(targetUserId);
    if (targetUser) {
      this.io.to(targetUser.socketId).emit('locationShareStopped', {
        fromUserId,
        fromName: this.userService.getOnlineUser(fromUserId)?.name || fromUserId
      });
      this.io.to(targetUser.socketId).emit('locationRemoved', { userId: fromUserId });
    }
  }

  handleStopReceivingShare(socket, data) {
    const { fromUserId } = data;
    const toUserId = socket.userId;

    if (!fromUserId || !toUserId) {
      socket.emit('shareRequestError', { message: '잘못된 요청입니다.' });
      return;
    }

    this.locationService.stopLocationShare(fromUserId, toUserId);

    const sharedUsers = this.locationService.getSharedUsers(fromUserId);
    const hasOtherShares = sharedUsers.size > 0;

    if (!hasOtherShares) {
      this.userService.setUserTracking(fromUserId, false);
      this.locationService.removeLocation(fromUserId);
      this.io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    }

    const fromUser = this.userService.getOnlineUser(fromUserId);
    if (fromUser) {
      this.io.to(fromUser.socketId).emit('locationShareStopped', {
        fromUserId: toUserId,
        fromName: this.userService.getOnlineUser(toUserId)?.name || toUserId
      });
    }
  }

  handleRequestCurrentLocation(socket, data = {}) {
    const requesterId = socket.userId;
    const { targetUserId } = data;

    if (!requesterId || !targetUserId) {
      socket.emit('locationAccessError', { message: '잘못된 위치 요청입니다.' });
      return;
    }

    const allowedUsers = this.locationService.getAllowedUsers(targetUserId);
    if (!allowedUsers.has(requesterId)) {
      socket.emit('locationAccessError', { message: '위치 공유 권한이 없습니다.' });
      return;
    }

    const targetLocation = this.locationService.getLocation(targetUserId);
    const targetHistory = this.locationService.getLocationHistory(targetUserId);

    if (!targetLocation || targetHistory.length === 0) {
      socket.emit('locationAccessError', { message: '공유 가능한 위치 정보가 없습니다.' });
      return;
    }

    socket.emit('locationReceived', {
      userId: targetUserId,
      lat: targetLocation.lat,
      lng: targetLocation.lng,
      timestamp: targetLocation.timestamp,
      path: targetHistory.map((h) => [h.lat, h.lng])
    });
  }
}

module.exports = LocationController;
