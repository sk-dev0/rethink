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
})

app.get('/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    res.render('lobby', { roomId });
});

app.get('/dialog', async (req, res) => {
    const socketId = req.query.socketId;
    
    await createSession(socketId);
    res.render('dialog', { socketId });
});

app.post('/dialog/message', async (req, res) => {
    const { socketId, message } = req.body;
    
    const reply = await sendMessage(socketId, message);
    res.json({ reply });
});

app.post('/dialog/profile', async (req, res) => {
    const { socketId, history } = req.body;
    const profile = await generateProfile(socketId, history);
    req.session.profile = profile;
    //ユーザーが増え続ける限り、チャットのキャッシュが残り続けるため削除する。
    deleteSession(socketId);
    res.json({ profile });
    // 開発中は残しておく。本番ではこのログは消す
    console.log('プロファイル生成完了:', profile);
});

app.get('/index', (req, res) => {
    res.render('index');
});

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

    socket.on('start', (roomId) => {
        io.to(roomId).emit('redirect', '/dialog');
    });

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