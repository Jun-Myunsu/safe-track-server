const User = require('../models/User');
const Friend = require('../models/Friend');

class UserService {
  constructor() {
    this.onlineUsers = new Map();
  }

  addOnlineUser(userId, socketId) {
    // 기존 사용자가 있다면 추적 중지
    if (this.onlineUsers.has(userId)) {
      const existingUser = this.onlineUsers.get(userId);
      existingUser.isTracking = false;
    }
    
    this.onlineUsers.set(userId, { 
      name: userId, 
      socketId, 
      isTracking: false // 항상 false로 시작
    });
  }

  removeOnlineUser(userId) {
    this.onlineUsers.delete(userId);
  }

  getOnlineUser(userId) {
    return this.onlineUsers.get(userId);
  }

  getAllOnlineUsers() {
    return Array.from(this.onlineUsers.entries()).map(([userId, userData]) => ({
      id: userId,
      name: userId,
      isOnline: true,
      isTracking: userData.isTracking
    }));
  }

  getOnlineUserCount() {
    return this.onlineUsers.size;
  }

  setUserTracking(userId, isTracking) {
    const user = this.onlineUsers.get(userId);
    if (user) {
      user.isTracking = isTracking;
    }
  }

  async searchUsers(query) {
    const searchResults = await User.search(query);
    
    return searchResults.map(user => {
      const onlineUser = this.onlineUsers.get(user.id);
      return {
        ...user,
        isOnline: !!onlineUser,
        isTracking: onlineUser ? onlineUser.isTracking : false
      };
    });
  }

  async getFriends(userId) {
    const friends = await Friend.getList(userId);
    
    return friends.map(friend => {
      const onlineUser = this.onlineUsers.get(friend.id);
      return {
        ...friend,
        isOnline: !!onlineUser,
        isTracking: onlineUser ? onlineUser.isTracking : false
      };
    });
  }

  async addFriend(userId, friendId) {
    const exists = await User.exists(friendId);
    if (!exists) {
      throw new Error('존재하지 않는 사용자입니다');
    }

    const success = await Friend.add(userId, friendId);
    if (!success) {
      throw new Error('친구 추가 중 오류가 발생했습니다');
    }

    return friendId;
  }

  async removeFriend(userId, friendId) {
    const success = await Friend.remove(userId, friendId);
    if (!success) {
      throw new Error('친구 삭제 중 오류가 발생했습니다');
    }

    return friendId;
  }
}

module.exports = UserService;