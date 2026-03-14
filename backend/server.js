const express = require('express');
const engine = require('ejs-mate');
const path = require('path');

const app = express();

app.engine('ejs', engine);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.send('テストホームページ');
});

app.use((req, res) => {
    res.send('404ページ');
});

app.listen(3000, (req, res) => {
    console.log('ポート3000でリクエスト待ち受け中...');
});