const express = require('express');
const engine = require('ejs-mate');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.engine('ejs', engine);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/dialog', (req, res) => {
    res.render('dialog');
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

    socket.on('disconnect', () => {
        console.log('切断されました:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('ポート3000でリクエスト待ち受け中...');
});