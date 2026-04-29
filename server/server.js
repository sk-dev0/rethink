require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const engine = require('ejs-mate');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const { createSession, getSession, deleteSession, startChat, sendMessage, generateProfile } = require('./services/geminiClient');
const { roomTotals, roomProfiles, roomThemes, roomMaxParticipants, socketRooms, completedSockets, roomHosted, roomResults } = require('./store');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.engine('ejs', engine);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

app.get('/', (req, res) => {
    const roomId = uuidv4();
    res.render('index', { roomId });
});

app.get('/index', (req, res) => {
    res.render('index');
});

// AI Debate API
const debateRoutes = require('./routes/debate');
app.use('/api/debate', debateRoutes);

const debateViewRoutes = require('./routes/debateView');
app.use('/debate', debateViewRoutes);

const roomRoutes = require('./routes/room');
app.use('/room', roomRoutes);

const dialogRoutes = require('./routes/dialog');
app.use('/dialog', dialogRoutes);

const waitingRoutes = require('./routes/waiting');
app.use('/waiting', waitingRoutes);

app.use((req, res) => {
    res.status(404).send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 100px;">
            <div style="display: inline-block; padding: 40px 60px; border: 2px solid #dee2e6; border-radius: 12px;">
                <h1 style="font-size: 72px; margin: 0;">404</h1>
                <h2>ページが見つかりません</h2>
                <p style="color: gray;">正しいURLでやり直してください。</p>
                <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 24px; background: #0d6efd; color: white; border-radius: 8px; text-decoration: none;">トップに戻る</a>
            </div>
        </div>
    `);
});

io.on('connection', (socket) => {
    console.log('接続されました:', socket.id);

    socket.on('joinRoom', (roomId) => {
        // 参加人数を渡し、設定した人数を超えていたら受け付けないようにする
        const currentSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        const max = roomMaxParticipants[roomId] || 4;
        
        if (currentSize >= max) {
            socket.emit('roomFull');
            return;
        }

        socket.join(roomId);
        console.log(`${socket.id}がルーム ${roomId} に参加しました`);
        // 現在のフェーズを設定する
        socketRooms[socket.id] = { roomId, phase: 'lobby' };

        io.to(roomId).emit('updateCount', io.sockets.adapter.rooms.get(roomId).size, max);
    });

    socket.on('joinWaiting', (roomId) => {
        // phaseをwaitingに変更
        socket.join(roomId + '-waiting');
        socketRooms[socket.id] = { roomId, phase: 'waiting' };
        console.log(`${socket.id}がルーム ${roomId} に参加しました`);

        // ルームの参加人数を取得、いなければ0とする
        const waitingRoom = io.sockets.adapter.rooms.get(roomId + '-waiting');
        const count = waitingRoom ? waitingRoom.size : 0;
        const total = roomTotals[roomId] || 0;

        io.to(roomId + '-waiting').emit('updateWaitingCount', count, total);
    });

    socket.on('joinDebate', (roomId) => {
        socket.join(roomId + '-debate');
    });

    socket.on('notifyDebateStarted', (roomId) => {
        socket.to(roomId + '-debate').emit('debateStarted');
    });

    socket.on('start', (roomId, topic) => {
        // roomIdとその人数を記録しておく
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        roomTotals[roomId] = roomSize;
        roomThemes[roomId] = topic;

        io.to(roomId).emit('redirect', '/dialog');
    });

    socket.on('startDiscussion', (roomId) => {
        socket.emit('redirectToDiscussion', `/debate/${roomId}?isHost=true`);
        socket.to(roomId + '-waiting').emit('redirectToDiscussion', `/debate/${roomId}`);
    })

    socket.on('initDialog', async (roomId) => {
        const topic = roomThemes[roomId] || '夜ご飯は何にするか';
        await createSession(socket.id, topic);
        // 対話を始めるためのイベント
        socket.emit('dialogReady');
    });

    socket.on('joinDialog', (roomId) => {
        socketRooms[socket.id] = { roomId, phase: 'dialog' };
    });

    socket.on('disconnect', () => {
        console.log('切断されました:', socket.id);
        //インタビュー途中で切断した場合も会話キャッシュを消すように
        deleteSession(socket.id); 

        const info = socketRooms[socket.id];
        if (!info) return;

        const { roomId, phase } = info;
        delete socketRooms[socket.id];

        if (phase === 'dialog') {
            if (completedSockets.has(socket.id)) {
                completedSockets.delete(socket.id);
            } else {
                // 本当の離脱
                if (roomTotals[roomId] && roomTotals[roomId] > 0) {
                    roomTotals[roomId]--;
                }
                const waitingRoom = io.sockets.adapter.rooms.get(roomId + '-waiting');
                const count = waitingRoom ? waitingRoom.size : 0;
                const total = roomTotals[roomId] || 0;
                io.to(roomId + '-waiting').emit('updateWaitingCount', count, total);
                console.log(`離脱検知: roomId=${roomId}, phase=${phase}, total=${total}`);
            }
        }

        if (phase === 'waiting') {
            if (roomTotals[roomId] && roomTotals[roomId] > 0) {
                roomTotals[roomId]--;
            }
            const waitingRoom = io.sockets.adapter.rooms.get(roomId + '-waiting');
            const count = waitingRoom ? waitingRoom.size : 0;
            const total = roomTotals[roomId] || 0;
            io.to(roomId + '-waiting').emit('updateWaitingCount', count, total);
            console.log(`離脱検知: roomId=${roomId}, phase=${phase}, total=${total}`);
        }
    });
});

server.listen(3000, () => {
    console.log('ポート3000でリクエスト待ち受け中...');
});
