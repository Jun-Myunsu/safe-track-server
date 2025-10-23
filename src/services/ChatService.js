class ChatService {
  constructor(locationService, userService) {
    this.locationService = locationService;
    this.userService = userService;
  }

  /**
   * 특정 사용자에게 메시지를 보낼 수 있는지 확인
   */
  canSendMessage(fromUserId, targetUserId) {
    const canSendToTarget = this.locationService.getSharedUsers(fromUserId).has(targetUserId);
    const canReceiveFromTarget = this.locationService.getSharedUsers(targetUserId).has(fromUserId);

    return canSendToTarget || canReceiveFromTarget;
  }

  /**
   * 현재 메시지를 받을 수 있는 모든 연결된 사용자 가져오기
   */
  getConnectedUsers(fromUserId) {
    const connectedUsers = new Set();

    // 내가 공유 중인 사용자들
    const myShares = this.locationService.getSharedUsers(fromUserId);
    myShares.forEach(userId => {
      if (this.userService.getOnlineUser(userId)) {
        connectedUsers.add(userId);
      }
    });

    // 나에게 공유 중인 사용자들
    const allUsers = this.userService.getAllOnlineUsers();
    allUsers.forEach(user => {
      const theirShares = this.locationService.getSharedUsers(user.userId);
      if (theirShares.has(fromUserId) && this.userService.getOnlineUser(user.userId)) {
        connectedUsers.add(user.userId);
      }
    });

    return Array.from(connectedUsers);
  }

  /**
   * 단일 사용자에게 메시지 생성 (기존 호환성 유지)
   */
  createMessage(fromUserId, targetUserId, message) {
    if (!this.canSendMessage(fromUserId, targetUserId)) {
      throw new Error('위치 공유 중인 사용자와만 채팅할 수 있습니다');
    }

    const targetUser = this.userService.getOnlineUser(targetUserId);
    if (!targetUser) {
      throw new Error('상대방이 오프라인입니다');
    }

    return {
      from: fromUserId,
      to: targetUserId,
      message,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 그룹 메시지 생성 (연결된 모든 사용자에게)
   */
  createGroupMessage(fromUserId, message) {
    const connectedUsers = this.getConnectedUsers(fromUserId);

    if (connectedUsers.length === 0) {
      throw new Error('연결된 사용자가 없습니다');
    }

    return {
      from: fromUserId,
      recipients: connectedUsers,
      message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ChatService;