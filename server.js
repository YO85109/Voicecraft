const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve index.html directly from the root folder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static assets from the root directory
app.use(express.static(__dirname));

// In-memory room store: roomId -> { password, users: Map(socketId -> { username }) }
const rooms = new Map();

io.on('connection', (socket) => {
    let currentRoomId = null;

    // 1. CREATE REALM
    socket.on('create-room', ({ roomId, password, username }, callback) => {
        roomId = (roomId || '').trim().toLowerCase();
        username = (username || 'Steve').trim();
        password = (password || '').trim();

        if (!roomId) {
            return callback({ success: false, message: 'REALM NAME REQUIRED!' });
        }

        // Auto-join if realm exists with matching password
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            if (room.password === password) {
                const existingUsers = Array.from(room.users.entries()).map(([id, data]) => ({
                    id,
                    username: data.username
                }));
                room.users.set(socket.id, { username });
                currentRoomId = roomId;
                socket.join(roomId);
                socket.to(roomId).emit('user-joined', { userId: socket.id, username });
                return callback({ success: true, roomId, existingUsers });
            } else {
                return callback({ success: false, message: 'REALM EXISTS WITH A DIFFERENT KEY!' });
            }
        }

        const roomUsers = new Map();
        roomUsers.set(socket.id, { username });
        rooms.set(roomId, { password, users: roomUsers });

        currentRoomId = roomId;
        socket.join(roomId);
        callback({ success: true, roomId, existingUsers: [] });
    });

    // 2. JOIN REALM
    socket.on('join-room', ({ roomId, password, username }, callback) => {
        roomId = (roomId || '').trim().toLowerCase();
        username = (username || 'Alex').trim();
        password = (password || '').trim();

        const room = rooms.get(roomId);
        if (!room) {
            return callback({ success: false, message: 'REALM NOT FOUND! CLICK CREATE INSTEAD.' });
        }
        if (room.password !== password) {
            return callback({ success: false, message: 'INCORRECT REALM KEY!' });
        }

        const existingUsers = Array.from(room.users.entries()).map(([id, data]) => ({
            id,
            username: data.username
        }));

        room.users.set(socket.id, { username });
        currentRoomId = roomId;
        socket.join(roomId);

        socket.to(roomId).emit('user-joined', { userId: socket.id, username });
        callback({ success: true, roomId, existingUsers });
    });

    // 3. WebRTC Signaling Relays
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', {
            sdp: data.sdp,
            callerId: socket.id,
            username: data.username
        });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', {
            sdp: data.sdp,
            responderId: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            senderId: socket.id
        });
    });

    // 4. Cleanup on Disconnect
    const handleLeave = () => {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (room) {
            room.users.delete(socket.id);
            socket.to(currentRoomId).emit('user-left', socket.id);
            if (room.users.size === 0) {
                rooms.delete(currentRoomId);
            }
        }
        socket.leave(currentRoomId);
        currentRoomId = null;
    };

    socket.on('leave-room', handleLeave);
    socket.on('disconnect', handleLeave);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server online at http://localhost:${PORT}`);
});
