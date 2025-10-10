require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const { initDatabase, createUser, getUser, searchUsers, userExists, addFriend, getFriends, removeFriend, createSession, getSession, updateSession, deleteSession, cleanExpiredSessions } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["https://safe-track-client.vercel.app", "http://localhost:3001"],
    methods: ["GET", "POST"]
  }
});

// 데이터베이스 초기화
initDatabase();

// 만료된 세션 정리 (1시간마다)
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

// 메모리 저장소 (세션 데이터용)
const users = new Map();
const locations = new Map();
const locationHistory = new Map();
const shareRequests = new Map();
const sharePermissions = new Map();

io.on('connection', (socket) => {
  console.log('사용자 연결:', socket.id, '| IP:', socket.handshake.address, '| User-Agent:', socket.handshake.headers['user-agent']);
  
  // 온라인 사용자 목록만 전송
  const onlineUsers = Array.from(users.entries()).map(([userId, userData]) => ({
    id: userId,
    name: userId,
    isOnline: true,
    isTracking: userData.isTracking
  }));
  socket.emit('userList', onlineUsers);

  socket.on('validateSession', async (data) => {
    const { sessionId } = data;
    const session = await getSession(sessionId);
    
    if (session) {
      const userId = session.user_id;
      users.set(userId, { name: userId, socketId: socket.id, isTracking: false });
      socket.userId = userId;
      socket.sessionId = sessionId;
      
      // 소켓 ID 업데이트
      await updateSession(sessionId, socket.id);
      
      socket.emit('sessionValid', { userId });
      
      const updatedUsers = Array.from(users.entries()).map(([uid, userData]) => ({
        id: uid,
        name: uid,
        isOnline: true,
        isTracking: userData.isTracking
      }));
      io.emit('userList', updatedUsers);
    } else {
      socket.emit('sessionInvalid');
    }
  });

  socket.on('reconnect', async (data) => {
    const { userId } = data;
    const userExists = await getUser(userId);
    if (userExists) {
      // 기존 세션 정리
      for (const [existingUserId, userData] of users.entries()) {
        if (existingUserId === userId) {
          users.delete(existingUserId);
          break;
        }
      }
      
      // 새 세션 생성
      users.set(userId, { name: userId, socketId: socket.id, isTracking: false });
      socket.userId = userId;
      
      const updatedUsers = Array.from(users.entries()).map(([uid, userData]) => ({
        id: uid,
        name: uid,
        isOnline: true,
        isTracking: userData.isTracking
      }));
      io.emit('userList', updatedUsers);
    }
  });

  socket.on('checkUserId', async (data) => {
    const { userId } = data;
    const exists = await userExists(userId);
    socket.emit('userIdCheckResult', { userId, isAvailable: !exists });
  });

  socket.on('register', async (userData) => {
    const { userId, password } = userData;
    
    if (!userId || !password) {
      socket.emit('registerError', { message: '아이디와 비밀번호를 입력하세요' });
      return;
    }
    
    const exists = await userExists(userId);
    if (exists) {
      socket.emit('registerError', { message: '이미 사용 중인 아이디입니다' });
      return;
    }
    
    const success = await createUser(userId, password);
    if (!success) {
      socket.emit('registerError', { message: '회원가입 중 오류가 발생했습니다' });
      return;
    }
    
    users.set(userId, { name: userId, socketId: socket.id, isTracking: false });
    socket.userId = userId;
    
    // 세션 생성
    const sessionId = await createSession(userId, socket.id);
    socket.sessionId = sessionId;
    
    socket.emit('registerSuccess', { userId, sessionId });
    
    const updatedUsers = Array.from(users.entries()).map(([uid, userData]) => ({
      id: uid,
      name: uid,
      isOnline: true,
      isTracking: userData.isTracking
    }));
    io.emit('userList', updatedUsers);
  });
  
  socket.on('login', async (userData) => {
    const { userId, password } = userData;
    
    if (!userId || !password) {
      socket.emit('loginError', { message: '아이디와 비밀번호를 입력하세요' });
      return;
    }
    
    const user = await getUser(userId);
    if (!user) {
      socket.emit('loginError', { message: '존재하지 않는 사용자입니다' });
      return;
    }
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      socket.emit('loginError', { message: '비밀번호가 일치하지 않습니다' });
      return;
    }
    
    // 기존 세션 정리
    for (const [existingUserId, userData] of users.entries()) {
      if (existingUserId === userId) {
        users.delete(existingUserId);
        break;
      }
    }
    
    // 새 세션 생성
    users.set(userId, { name: userId, socketId: socket.id, isTracking: false });
    socket.userId = userId;
    
    // 세션 생성
    const sessionId = await createSession(userId, socket.id);
    socket.sessionId = sessionId;
    
    socket.emit('loginSuccess', { userId, sessionId });
    
    // 온라인 사용자 목록 업데이트
    const updatedUsers = Array.from(users.entries()).map(([uid, userData]) => ({
      id: uid,
      name: uid,
      isOnline: true,
      isTracking: userData.isTracking
    }));
    io.emit('userList', updatedUsers);
  });

  socket.on('startTracking', (data) => {
    const { userId } = data;
    if (users.has(userId)) {
      users.get(userId).isTracking = true;
      io.emit('trackingStatusUpdate', { userId, isTracking: true });
    }
  });

  socket.on('locationUpdate', (data) => {
    const { userId, lat, lng } = data;
    const timestamp = new Date().toISOString();
    const locationData = { lat, lng, timestamp };
    
    locations.set(userId, locationData);
    
    if (!locationHistory.has(userId)) {
      locationHistory.set(userId, []);
    }
    const history = locationHistory.get(userId);
    history.push(locationData);
    if (history.length > 50) {
      history.shift();
    }
    
    const allowedUsers = sharePermissions.get(userId) || new Set();
    const targetUsers = new Set([userId, ...allowedUsers]);
    
    targetUsers.forEach(targetUserId => {
      const targetUser = users.get(targetUserId);
      if (targetUser) {
        io.to(targetUser.socketId).emit('locationReceived', { 
          userId, 
          lat, 
          lng, 
          timestamp,
          path: history.map(h => [h.lat, h.lng])
        });
      }
    });
  });

  socket.on('stopTracking', (data) => {
    const { userId } = data;
    if (users.has(userId)) {
      users.get(userId).isTracking = false;
      locations.delete(userId);
      io.emit('trackingStatusUpdate', { userId, isTracking: false });
    }
  });

  socket.on('requestLocationShare', async (data) => {
    const { targetUserId } = data;
    const fromUserId = socket.userId;
    
    const targetExists = await userExists(targetUserId);
    if (!targetExists) {
      socket.emit('shareRequestError', { message: '존재하지 않는 사용자입니다' });
      return;
    }
    
    if (!users.has(targetUserId)) {
      socket.emit('shareRequestError', { message: '해당 사용자가 현재 오프라인입니다' });
      return;
    }
    
    const targetUser = users.get(targetUserId);
    const requestId = `${fromUserId}_${targetUserId}_${Date.now()}`;
    
    shareRequests.set(requestId, {
      from: fromUserId,
      to: targetUserId,
      status: 'pending'
    });
    
    io.to(targetUser.socketId).emit('locationShareRequest', {
      requestId,
      from: fromUserId,
      fromName: users.get(fromUserId).name
    });
    
    socket.emit('shareRequestSent', { targetUserId, targetName: targetUserId });
  });

  socket.on('respondLocationShare', (data) => {
    const { requestId, accepted } = data;
    const request = shareRequests.get(requestId);
    
    if (request) {
      request.status = accepted ? 'accepted' : 'rejected';
      
      if (accepted) {
        if (!sharePermissions.has(request.from)) {
          sharePermissions.set(request.from, new Set());
        }
        sharePermissions.get(request.from).add(request.to);
      }
      
      const fromUser = users.get(request.from);
      if (fromUser) {
        io.to(fromUser.socketId).emit('locationShareResponse', {
          requestId,
          accepted,
          targetUserId: request.to,
          targetName: users.get(request.to).name
        });
        
        if (accepted) {
          const fromUserLocation = locations.get(request.from);
          const fromUserHistory = locationHistory.get(request.from);
          
          if (fromUserLocation && fromUserHistory) {
            const toUser = users.get(request.to);
            if (toUser) {
              io.to(toUser.socketId).emit('locationReceived', {
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
  });

  socket.on('stopLocationShare', (data) => {
    const { targetUserId } = data;
    const fromUserId = socket.userId;
    
    if (sharePermissions.has(fromUserId)) {
      sharePermissions.get(fromUserId).delete(targetUserId);
      if (sharePermissions.get(fromUserId).size === 0) {
        sharePermissions.delete(fromUserId);
      }
    }
    
    // 요청자의 위치 추적 중단
    if (users.has(fromUserId)) {
      users.get(fromUserId).isTracking = false;
      locations.delete(fromUserId);
      io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    }
    
    const targetUser = users.get(targetUserId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('locationShareStopped', {
        fromUserId,
        fromName: users.get(fromUserId).name
      });
      io.to(targetUser.socketId).emit('locationRemoved', {
        userId: fromUserId
      });
    }
  });

  socket.on('stopReceivingShare', (data) => {
    const { fromUserId } = data;
    const toUserId = socket.userId;
    
    // fromUserId의 권한에서 toUserId 제거
    if (sharePermissions.has(fromUserId)) {
      sharePermissions.get(fromUserId).delete(toUserId);
      if (sharePermissions.get(fromUserId).size === 0) {
        sharePermissions.delete(fromUserId);
      }
    }
    
    // 요청자의 위치 추적 중단
    if (users.has(fromUserId)) {
      users.get(fromUserId).isTracking = false;
      locations.delete(fromUserId);
      io.emit('trackingStatusUpdate', { userId: fromUserId, isTracking: false });
    }
    
    // fromUserId에게 공유 중지 알림
    const fromUser = users.get(fromUserId);
    if (fromUser) {
      io.to(fromUser.socketId).emit('locationShareStopped', {
        fromUserId: toUserId,
        fromName: users.get(toUserId).name
      });
    }
  });

  socket.on('requestCurrentLocation', (data) => {
    const { targetUserId } = data;
    const requesterId = socket.userId;
    
    const targetLocation = locations.get(targetUserId);
    const targetHistory = locationHistory.get(targetUserId);
    
    if (targetLocation && targetHistory) {
      socket.emit('locationReceived', {
        userId: targetUserId,
        lat: targetLocation.lat,
        lng: targetLocation.lng,
        timestamp: targetLocation.timestamp,
        path: targetHistory.map(h => [h.lat, h.lng])
      });
    }
  });

  socket.on('searchUsers', async (data) => {
    const { query } = data;
    const searchResults = await searchUsers(query);
    
    // 온라인 상태 업데이트
    const resultsWithStatus = searchResults.map(user => {
      const onlineUser = users.get(user.id);
      return {
        ...user,
        isOnline: !!onlineUser,
        isTracking: onlineUser ? onlineUser.isTracking : false
      };
    });
    
    socket.emit('searchResults', { users: resultsWithStatus });
  });

  socket.on('addFriend', async (data) => {
    const { targetUserId } = data;
    const fromUserId = socket.userId;
    
    const targetExists = await userExists(targetUserId);
    if (!targetExists) {
      socket.emit('friendAddError', { message: '존재하지 않는 사용자입니다' });
      return;
    }
    
    const success = await addFriend(fromUserId, targetUserId);
    if (success) {
      socket.emit('friendAdded', { friendId: targetUserId });
    } else {
      socket.emit('friendAddError', { message: '친구 추가 중 오류가 발생했습니다' });
    }
  });

  socket.on('getFriends', async (data) => {
    const userId = socket.userId;
    const friends = await getFriends(userId);
    
    // 온라인 상태 업데이트
    const friendsWithStatus = friends.map(friend => {
      const onlineUser = users.get(friend.id);
      return {
        ...friend,
        isOnline: !!onlineUser,
        isTracking: onlineUser ? onlineUser.isTracking : false
      };
    });
    
    socket.emit('friendsList', { friends: friendsWithStatus });
  });

  socket.on('removeFriend', async (data) => {
    const { friendId } = data;
    const userId = socket.userId;
    
    const success = await removeFriend(userId, friendId);
    if (success) {
      socket.emit('friendRemoved', { friendId });
    } else {
      socket.emit('friendRemoveError', { message: '친구 삭제 중 오류가 발생했습니다' });
    }
  });

  socket.on('sendMessage', (data) => {
    const { targetUserId, message } = data;
    const fromUserId = socket.userId;
    
    const canSendToTarget = sharePermissions.get(fromUserId)?.has(targetUserId);
    const canReceiveFromTarget = sharePermissions.get(targetUserId)?.has(fromUserId);
    
    if (!canSendToTarget && !canReceiveFromTarget) {
      socket.emit('chatError', { message: '위치 공유 중인 사용자와만 채팅할 수 있습니다' });
      return;
    }
    
    const targetUser = users.get(targetUserId);
    if (!targetUser) {
      socket.emit('chatError', { message: '상대방이 오프라인입니다' });
      return;
    }
    
    const messageData = {
      from: fromUserId,
      to: targetUserId,
      message,
      timestamp: new Date().toISOString()
    };
    
    io.to(targetUser.socketId).emit('messageReceived', messageData);
    socket.emit('messageSent', messageData);
  });

  socket.on('logout', async (data) => {
    const { userId } = data;
    const user = users.get(userId);
    
    if (user) {
      user.isTracking = false;
      locations.delete(userId);
      users.delete(userId);
      
      // 세션 삭제
      if (socket.sessionId) {
        await deleteSession(socket.sessionId);
      }
      
      const updatedUsers = Array.from(users.entries()).map(([uid, userData]) => ({
        id: uid,
        name: uid,
        isOnline: true,
        isTracking: userData.isTracking
      }));
      io.emit('userList', updatedUsers);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      const user = users.get(socket.userId);
      if (user && user.socketId === socket.id) {
        user.isTracking = false;
        locations.delete(socket.userId);
        users.delete(socket.userId);
        io.emit('trackingStatusUpdate', { userId: socket.userId, isTracking: false });
        
        // 지연된 사용자 목록 업데이트 (재연결 시간 고려)
        setTimeout(() => {
          const updatedUsers = Array.from(users.entries()).map(([uid, userData]) => ({
            id: uid,
            name: uid,
            isOnline: true,
            isTracking: userData.isTracking
          }));
          io.emit('userList', updatedUsers);
        }, 1000);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Safe Track Server running on port ${PORT}`);
});