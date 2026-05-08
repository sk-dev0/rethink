const express = require('express');
const router = express.Router();
const { roomHosted, roomMaxParticipants } = require('../store');

router.get('/:roomId/host', (req, res, next) => {
    try {
        const roomId = req.params.roomId;
        if (roomHosted[roomId]) {
            return res.redirect('/room/' + roomId);
        }
        roomHosted[roomId] = true;
        const max = parseInt(req.query.max) || 4;
        roomMaxParticipants[roomId] = max;
        res.render('host', { roomId });
    } catch (err) {
        next(err);
    }
});

router.get('/:roomId', (req, res, next) => {
    try {
        const roomId = req.params.roomId;
        res.render('lobby', { roomId });
    } catch (err) {
        next(err);
    }

});

module.exports = router;