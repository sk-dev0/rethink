/**
 * routes/debate.js
 * AI Debate のHTTPエンドポイント定義のみを担う
 * ビジネスロジックは一切持たない
 */

const express = require('express');
const router = express.Router();
const { runDebate } = require('../services/debateEngine');

/**
 * GET /
 * debate画面をレンダリング
 */
router.get('/', (req, res) => {
    res.render('index');
});

/**
 * POST /api/debate/start
 * 議論開始エンドポイント
 * Body: { topic: string, agents: Array, maxTurns: number }
 * agents の各要素: { label, coreClaim, rationale, preconditions, experience? }
 */
router.post('/start', async (req, res) => {
    const { topic, agents, maxTurns } = req.body;

    // バリデーション
    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
        return res.status(400).json({ success: false, error: '議題（topic）は必須です' });
    }

    if (!Array.isArray(agents) || agents.length < 2) {
        return res.status(400).json({ success: false, error: 'エージェントは2件以上必要です' });
    }

    for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const missing = [];
        if (!agent.label) missing.push('label');
        if (!agent.coreClaim) missing.push('coreClaim');
        if (!agent.rationale) missing.push('rationale');
        if (!agent.preconditions) missing.push('preconditions');
        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                error: `エージェント[${i}] に必須項目が不足しています: ${missing.join(', ')}`,
            });
        }
    }

    try {
        const result = await runDebate(topic, agents, maxTurns);
        if (req.body.roomId) global.roomResults[req.body.roomId] = result;
        res.json(result);
    } catch (err) {
        console.error('[debate/start] エラー:', err);
        res.status(500).json({ error: '議論の実行中にエラーが発生しました', detail: err.message });
    }
});

module.exports = router;
