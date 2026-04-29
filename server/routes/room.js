const express = require('express');
const router = express.Router();
const { roomHosted, roomMaxParticipants } = require('../store');

router.get('/:roomId/host', (req, res) => {
    const roomId = req.params.roomId;
    if (roomHosted[roomId]) {
        return res.redirect('/room/' + roomId);
    }
    roomHosted[roomId] = true;
    const max = parseInt(req.query.max) || 4;
    roomMaxParticipants[roomId] = max;
    res.render('host', { roomId });
});

router.get('/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    res.render('lobby', { roomId });
});

module.exports = router;