const express = require('express');
const router = express.Router();

const { roomHosted } = require('../store');

router.get('/:roomId/host', (req, res) => {
    const roomId = req.params.roomId;
    if (!roomHosted[roomId]) {
        return res.redirect('/waiting/' + roomId);
    }
    res.render('waiting', { roomId, isHost: true });
});

router.get('/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    res.render('waiting', { roomId, isHost: false });
});

module.exports = router;