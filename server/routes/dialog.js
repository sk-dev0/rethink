const express = require('express');
const router = express.Router();

const { roomProfiles, completedSockets } = require('./store');
const { createSession, deleteSession, sendMessage, generateProfile } = require('./services/geminiClient');

router.get('/', async (req, res) => {
    const socketId = req.query.socketId;
    const roomId = req.query.roomId;
    const isHost = req.query.isHost === 'true';
    await createSession(socketId);
    res.render('dialog', { socketId, roomId, isHost });
});

router.post('/message', async (req, res) => {
    const { socketId, message } = req.body;
    
    const reply = await sendMessage(socketId, message);
    res.json({ reply });
});

router.post('/profile', async (req, res) => {
    const { socketId, history, roomId } = req.body;
    const profile = await generateProfile(socketId, history);
    if (!roomProfiles[roomId]) roomProfiles[roomId] = [];
    roomProfiles[roomId].push(profile);
    completedSockets.add(socketId);
    //ユーザーが増え続ける限り、チャットのキャッシュが残り続けるため削除する。
    deleteSession(socketId);
    res.json({ profile });
    // 開発中は残しておく。本番ではこのログは消す
    console.log('プロファイル生成完了:', profile);
});

module.exports = router;