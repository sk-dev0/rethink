require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const engine = require('ejs-mate');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const { createSession, getSession, deleteSession, startChat, sendMessage, generateProfile } = require('./services/geminiClient');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 参加人数を管理するためのオブジェクト
const roomTotals = {};
// ルームごとのプロフィールを管理するオブジェクト
const roomProfiles = {};

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

app.get('/room/:roomId/host', (req, res) => {
    const roomId = req.params.roomId;
    res.render('host', { roomId });
});

app.get('/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    res.render('lobby', { roomId });
});

app.get('/dialog', async (req, res) => {
    const socketId = req.query.socketId;
    const roomId = req.query.roomId;
    const isHost = req.query.isHost === 'true';
    await createSession(socketId);
    res.render('dialog', { socketId, roomId, isHost });
});

app.post('/dialog/message', async (req, res) => {
    const { socketId, message } = req.body;
    
    const reply = await sendMessage(socketId, message);
    res.json({ reply });
});

app.post('/dialog/profile', async (req, res) => {
    const { socketId, history, roomId } = req.body;
    const profile = await generateProfile(socketId, history);
    if (!roomProfiles[roomId]) roomProfiles[roomId] = [];
    roomProfiles[roomId].push(profile);
    //ユーザーが増え続ける限り、チャットのキャッシュが残り続けるため削除する。
    deleteSession(socketId);
    res.json({ profile });
    // 開発中は残しておく。本番ではこのログは消す
    console.log('プロファイル生成完了:', profile);
});

app.get('/waiting/:roomId/host', (req, res) => {
    const roomId = req.params.roomId;
    res.render('waiting', { roomId, isHost: true });
});

app.get('/waiting/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    res.render('waiting', { roomId, isHost: false });
});

app.get('/discussion', (req, res) => {
    res.render('discussion');
});

app.get('/index', (req, res) => {
    res.render('index');
});

// ここで生成したプロフィールを渡すようにした
app.get('/debate/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const profiles = roomProfiles[roomId] || [];
    res.render('debate', { profiles });
});

//AI同士の議論フェーズ画面（現状まだ独立している）
app.get('/debate', (req, res) => {
    res.render('debate');
});

// debate2.ejs をブラウザで直接確認するための表示ルート
app.get('/debate2', (req, res) => {
    res.render('debate2');
});

// コメント: debate3 の単独確認ルートは不要になったため削除

// AI Debate API
const debateRoutes = require('./routes/debate');
app.use('/api/debate', debateRoutes);

app.use((req, res) => {
    res.send('404ページ');
});

io.on('connection', (socket) => {
    console.log('接続されました:', socket.id);

    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        console.log(`${socket.id}がルーム ${roomId} に参加しました`);

        io.to(roomId).emit('updateCount', io.sockets.adapter.rooms.get(roomId).size);
    });

    socket.on('joinWaiting', (roomId) => {
        socket.join(roomId + '-waiting');
        console.log(`${socket.id}がルーム ${roomId} に参加しました`);

        // ルームの参加人数を取得、いなければ0とする
        const waitingRoom = io.sockets.adapter.rooms.get(roomId + '-waiting');
        const count = waitingRoom ? waitingRoom.size : 0;
        const total = roomTotals[roomId] || 0;

        io.to(roomId + '-waiting').emit('updateWaitingCount', count, total);
    })

    socket.on('start', (roomId) => {
        // roomIdとその人数を記録しておく
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        roomTotals[roomId] = roomSize;
        io.to(roomId).emit('redirect', '/dialog');
    });

    socket.on('startDiscussion', (roomId) => {
        io.to(roomId + '-waiting').emit('redirectToDiscussion', `/debate/${roomId}`);
    })

    socket.on('initDialog', async () => {
        // 第2引数のテーマは現在は仮のテーマにしている
        await createSession(socket.id, '夜ご飯は何にするか');
        // 対話を始めるためのイベント
        socket.emit('dialogReady');
    });

    socket.on('disconnect', () => {
        console.log('切断されました:', socket.id);
        //インタビュー途中で切断した場合も会話キャッシュを消すように
        deleteSession(socket.id); 
    });
});

server.listen(3000, () => {
    console.log('ポート3000でリクエスト待ち受け中...');
});
