const express = require('express');
const router = express.Router();
const { roomResults, roomProfiles, roomThemes } = require('../store');

router.get('/', (req, res) => {
    res.render('debate');
});

// ここで生成したプロフィールを渡すようにした
router.get('/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const profiles = roomProfiles[roomId] || [];
    const topic = roomThemes[roomId] || '';
    const isHost = req.query.isHost === 'true';
    res.render('debate', { profiles, topic, isHost, roomId});
});

// テスト用ルート
router.get('/debug', (req, res) => {
    const dummyProfiles = [
        {
            socketId: 'dummy-1',
            core_claim: '授業へのスマホ持ち込みを認めるべきだ',
            rationale: '調べ学習や辞書代わりとして活用でき、学習効率が上がる',
            preconditions: '適切なルールを設けた上での使用を前提とする',
            experience: '実際に調べ学習でスマホを使った授業の方が理解度が高かった'
        },
        {
            socketId: 'dummy-2',
            core_claim: '授業へのスマホ持ち込みは認めるべきでない',
            rationale: 'SNSやゲームへの誘惑があり、集中力が低下する',
            preconditions: '自己管理が難しい年齢層を対象とした場合に限る',
            experience: 'スマホを持ち込んだクラスでは授業中の私語や脱線が増えた'
        },
        {
            socketId: 'dummy-3',
            core_claim: '授業の内容や状況に応じて柔軟に判断すべきだ',
            rationale: '一律禁止や許可より、場面に応じた使い分けが現実的である',
            preconditions: '教師と生徒が使用ルールについて合意形成できることが前提',
            experience: '実際に教科によってスマホの有用性が大きく異なると感じた'
        },
        {
            socketId: 'dummy-4',
            core_claim: '保護者や地域社会も含めた幅広い議論が必要だ',
            rationale: 'スマホの使用は学校だけの問題ではなく家庭環境にも依存するため',
            preconditions: '学校単独での決定ではなく保護者との合意が必要である',
            experience: '保護者間でスマホの使用方針が異なり学校のルールと家庭のルールが矛盾することを経験した'
        }
    ];
    const topic = '授業にスマホの使用を認めるべきか';
    res.render('debate', { profiles: dummyProfiles, topic });
});

module.exports = router;