const express = require('express');
const router = express.Router();

const { roomHosted } = require('../store');

router.get('/:roomId/host', (req, res, next) => {
    try {
        const roomId = req.params.roomId;
        if (!roomHosted[roomId]) {
            return res.redirect('/waiting/' + roomId);
        }
        res.render('waiting', { roomId, isHost: true });
    } catch (err) {
        next(err);
    }
});

router.get('/:roomId', (req, res, next) => {
    try {
        const roomId = req.params.roomId;
        res.render('waiting', { roomId, isHost: false });
    } catch (err) {
        next(err);
    }
});

module.exports = router;