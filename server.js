const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// JSON 파일 경로
const USERS_FILE = path.join(__dirname, 'users.json');

// JSON 파일에서 사용자 데이터 로드
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      const usersArray = JSON.parse(data);
      return new Map(usersArray);
    }
  } catch (error) {
    console.error('사용자 데이터 로드 실패:', error);
  }
  return new Map();
}

// JSON 파일에 사용자 데이터 저장
function saveUsers() {
  try {
    const usersArray = Array.from(registeredUsers.entries());
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2));
  } catch (error) {
    console.error('사용자 데이터 저장 실패:', error);
  }
}

// 메모리 저장소
const registeredUsers = loadUsers();
const users = new Map();
const locations = new Map();
const locationHistory = new Map();
const shareRequests = new Map();
const sharePermissions = new Map();

io.on('connection', (socket) => {
  console.log('사용자 연결:', socket.id);
  
  const allUsers = Array.from(registeredUsers.keys()).map(userId => {
    const onlineUser = users.get(userId);
    return {
      id: userId,
      name: userId,
      isOnline: !!onlineUser,
      isTracking: onlineUser ? onlineUser.isTracking : false
    };
  });
  socket.emit('userList', allUsers);

  socket.on('reconnect', (data) => {
    const { userId } = data;
    if (registeredUsers.has(userId)) {
      users.set(userId, { name: userId, socketId: socket.id, isTracking: false });
      socket.userId = userId;
      
      const updatedUsers = Array.from(registeredUsers.keys()).map(uid => {
        const onlineUser = users.get(uid);
        return {
          id: uid,
          name: uid,
          isOnline: !!onlineUser,
          isTracking: onlineUser ? onlineUser.isTracking : false
        };
      });
      io.emit('userList', updatedUsers);
    }
  });

  socket.on('checkUserId', (data) => {
    const { userId } = data;
    const isAvailable = !registeredUsers.has(userId);
    socket.emit('userIdCheckResult', { userId, isAvailable });
  });

  socket.on('register', (userData) => {
    const { userId, password } = userData;
    
    if (!userId || !password) {
      socket.emit('registerError', { message: '아이디와 비밀번호를 입력하세요' });
      return;
    }
    
    if (registeredUsers.has(userId)) {
      socket.emit('registerError', { message: '이미 사용 중인 아이디입니다' });
      return;
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    registeredUsers.set(userId, { password: hashedPassword, createdAt: new Date() });
    saveUsers();
    users.set(userId, { name: userId, socketId: socket.id, isTracking: false });
    socket.userId = userId;
    
    socket.emit('registerSuccess', { userId });
    
    const updatedUsers = Array.from(registeredUsers.keys()).map(uid => {
      const onlineUser = users.get(uid);
      return {
        id: uid,
        name: uid,
        isOnline: !!onlineUser,
        isTracking: onlineUser ? onlineUser.isTracking : false
      };
    });
    io.emit('userList', updatedUsers);
  });
  
  socket.on('login', (userData) => {
    const { userId, password } = userData;
    
    if (!userId || !password) {
      socket.emit('loginError', { message: '아이디와 비밀번호를 입력하세요' });
      return;
    }
    
    if (!registeredUsers.has(userId)) {
      socket.emit('loginError', { message: '존재하지 않는 사용자입니다' });
      return;
    }
    
    const user = registeredUsers.get(userId);
    if (!bcrypt.compareSync(password, user.password)) {
      socket.emit('loginError', { message: '비밀번호가 일치하지 않습니다' });
      return;
    }
    
    users.set(userId, { name: userId, socketId: socket.id, isTracking: false });
    socket.userId = userId;
    
    socket.emit('loginSuccess', { userId });
    
    const updatedUsers = Array.from(registeredUsers.keys()).map(uid => {
      const onlineUser = users.get(uid);
      return {
        id: uid,
        name: uid,
        isOnline: !!onlineUser,
        isTracking: onlineUser ? onlineUser.isTracking : false
      };
    });
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

  socket.on('requestLocationShare', (data) => {
    const { targetUserId } = data;
    const fromUserId = socket.userId;
    
    if (!registeredUsers.has(targetUserId)) {
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

  socket.on('disconnect', () => {
    if (socket.userId) {
      const user = users.get(socket.userId);
      if (user) {
        user.isTracking = false;
        locations.delete(socket.userId);
        users.delete(socket.userId);
        io.emit('trackingStatusUpdate', { userId: socket.userId, isTracking: false });
        
        const updatedUsers = Array.from(registeredUsers.keys()).map(uid => {
          const onlineUser = users.get(uid);
          return {
            id: uid,
            name: uid,
            isOnline: !!onlineUser,
            isTracking: onlineUser ? onlineUser.isTracking : false
          };
        });
        io.emit('userList', updatedUsers);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Safe Track Server running on port ${PORT}`);
});s.get(targetUserId)?.has(fromUserId);
    
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

  socket.on('disconnect', () => {
    if (socket.userId) {
      const user = users.get(socket.userId);
      if (user) {
        user.isTracking = false;
        locations.delete(socket.userId);
        users.delete(socket.userId);
        io.emit('trackingStatusUpdate', { userId: socket.userId, isTracking: false });
        
        const updatedUsers = Array.from(registeredUsers.keys()).map(uid => {
          const onlineUser = users.get(uid);
          return {
            id: uid,
            name: uid,
            isOnline: !!onlineUser,
            isTracking: onlineUser ? onlineUser.isTracking : false
          };
        });
        io.emit('userList', updatedUsers);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Safe Track Server running on port ${PORT}`);
});