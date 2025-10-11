const User = require('../models/User');

class UserController {
  constructor(userService, io) {
    this.userService = userService;
    this.io = io;
  }

  async handleCheckUserId(socket, data) {
    const { userId } = data;
    const exists = await User.exists(userId);
    socket.emit('userIdCheckResult', { userId, isAvailable: !exists });
  }

  async handleReconnect(socket, data) {
    const { userId } = data;
    const userExists = await User.findById(userId);
    
    if (userExists) {
      this.userService.removeOnlineUser(userId);
      this.userService.addOnlineUser(userId, socket.id);
      socket.userId = userId;
      
      this.io.emit('userList', this.userService.getAllOnlineUsers());
    }
  }

  async handleSearchUsers(socket, data) {
    try {
      const { query } = data;
      const searchResults = await this.userService.searchUsers(query);
      socket.emit('searchResults', { users: searchResults });
    } catch (error) {
      socket.emit('searchError', { message: '검색 중 오류가 발생했습니다' });
    }
  }

  async handleAddFriend(socket, data) {
    try {
      const { targetUserId } = data;
      const fromUserId = socket.userId;
      
      const friendId = await this.userService.addFriend(fromUserId, targetUserId);
      socket.emit('friendAdded', { friendId });
    } catch (error) {
      socket.emit('friendAddError', { message: error.message });
    }
  }

  async handleGetFriends(socket, data) {
    try {
      const userId = socket.userId;
      const friends = await this.userService.getFriends(userId);
      socket.emit('friendsList', { friends });
    } catch (error) {
      socket.emit('friendsError', { message: '친구 목록 조회 중 오류가 발생했습니다' });
    }
  }

  async handleRemoveFriend(socket, data) {
    try {
      const { friendId } = data;
      const userId = socket.userId;
      
      await this.userService.removeFriend(userId, friendId);
      socket.emit('friendRemoved', { friendId });
    } catch (error) {
      socket.emit('friendRemoveError', { message: error.message });
    }
  }
}

module.exports = UserController;