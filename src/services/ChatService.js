class ChatService {
  constructor(locationService, userService) {
    this.locationService = locationService;
    this.userService = userService;
  }

  canSendMessage(fromUserId, targetUserId) {
    const canSendToTarget = this.locationService.getSharedUsers(fromUserId).has(targetUserId);
    const canReceiveFromTarget = this.locationService.getSharedUsers(targetUserId).has(fromUserId);
    
    return canSendToTarget || canReceiveFromTarget;
  }

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
}

module.exports = ChatService;