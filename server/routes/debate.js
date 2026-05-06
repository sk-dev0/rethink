/**
 * routes/debate.js
 * AI Debate のHTTPエンドポイント定義のみを担う
 * ビジネスロジックは一切持たない
 */

const express = require('express');
const router = express.Router();
const { runDebate } = require('../services/debateEngine');
const { roomResults } = require('../store');

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
        if (req.body.roomId) roomResults[req.body.roomId] = result;
        res.json(result);
    } catch (err) {
        console.error('[debate/start] エラー:', err);
        res.status(500).json({ error: '議論の実行中にエラーが発生しました', detail: err.message });
    }
});

router.get('/result/debug-room', (req, res) => {
    res.json({
        ready: true,
        result: {
            phase1: [
                { label: 'A', text: 'スマホは学習ツールとして有効です。調べ学習や辞書として活用でき、学習効率が向上します。' },
                { label: 'B', text: 'スマホは集中力を妨げます。SNSやゲームへの誘惑があり、授業に集中できなくなります。' },
                { label: 'C', text: '場面に応じた柔軟な判断が必要です。一律の禁止や許可より状況に応じた使い分けが現実的です。' },
                { label: 'D', text: '保護者や地域社会も含めた幅広い議論が必要です。家庭環境にも依存する問題です。' },
            ],
            phase2: {
                research: [
                    { label: 'A', text: '文部科学省の調査によると、ICT活用授業では理解度が15%向上したという結果があります。' },
                    { label: 'B', text: 'スマホ使用と学力低下の相関を示す研究が複数存在します。特に中学生で顕著です。' },
                    { label: 'C', text: '海外では教科ごとに使用ルールを設ける学校が増えており、成果を上げています。' },
                    { label: 'D', text: '保護者の72%がスマホの学校持ち込みについてルールの明確化を求めています。' },
                ],
                credibility: '各エージェントの情報は概ね信頼性が高いと判断されます。ただしAとBの主張は相反しており、文脈依存性が高い点に注意が必要です。',
                rebuttals: [
                    { attacker: 'A', defender: 'B', text: 'BはSNSへの誘惑を指摘していますが、適切なフィルタリングとルール設定で対処可能です。' },
                    { attacker: 'B', defender: 'A', text: 'Aは学習効率向上を主張しますが、自己管理能力が低い生徒には逆効果になる可能性があります。' },
                    { attacker: 'C', defender: 'A', text: 'Aの主張は全教科への一律適用を前提としており、場面依存性を考慮していません。' },
                    { attacker: 'D', defender: 'C', text: 'Cの提案は理想的ですが、学校単独での決定では保護者との乖離が生じる恐れがあります。' },
                ],
                subTopics: [
                    { id: 'sub_0', title: '自己管理能力と年齢の関係', reason: '反論で繰り返し登場した論点', depth: 0 },
                    { id: 'sub_1', title: 'フィルタリング技術の実効性', reason: 'スマホ使用を認める前提条件として重要', depth: 0 },
                ],
                decomposition: {
                    '自己管理能力と年齢の関係': {
                        claims: ['中学生は自己管理が難しい', '高校生は自律的に判断できる'],
                        evidence: ['発達心理学の知見'],
                        values: ['自律性の尊重', '教育的保護'],
                    }
                }
            },
            phase3: [
                {
                    subTopic: { id: 'sub_0', title: '自己管理能力と年齢の関係', depth: 0 },
                    discussionLog: [
                        {
                            turn: 1, subStep: 'α',
                            utterances: [
                                { label: 'A', text: '年齢よりも個人差の方が大きいと考えます。一律に年齢で判断するのは適切ではありません。' },
                                { label: 'B', text: '発達心理学的に見て、前頭前野の発達は18歳頃まで続くため、中学生の自己管理には限界があります。' },
                            ]
                        },
                        {
                            turn: 1, subStep: 'β',
                            utterances: [
                                { label: 'A', text: 'Bの指摘は理解できますが、だからこそ学校がサポートしながらスマホの使い方を教える機会にすべきです。' },
                                { label: 'B', text: 'サポート体制が整っていない現状では、リスクを先に排除すべきです。' },
                            ]
                        }
                    ],
                    subSubTopics: []
                },
                {
                    subTopic: { id: 'sub_1', title: 'フィルタリング技術の実効性', depth: 0 },
                    discussionLog: [
                        {
                            turn: 1, subStep: 'α',
                            utterances: [
                                { label: 'A', text: '現在のフィルタリング技術は高度に発展しており、SNSやゲームを効果的にブロックできます。' },
                                { label: 'C', text: 'フィルタリングの抜け道は常に存在し、技術的な解決策には限界があります。' },
                            ]
                        }
                    ],
                    subSubTopics: []
                }
            ],
            phase4: {
                synthesis: {
                    turn1: [
                        { label: 'A', text: '議論を通じて、スマホの有効活用には適切なルールと教育が不可欠だという認識を深めました。' },
                        { label: 'B', text: '完全禁止より段階的な導入の方が現実的だと考えを修正しました。ただし十分なサポート体制が前提です。' },
                        { label: 'C', text: '教科ごとの使用ルール設定と保護者との合意形成を組み合わせるアプローチを支持します。' },
                        { label: 'D', text: '学校・家庭・地域が連携したガイドライン策定が最も重要だという立場を維持します。' },
                    ],
                    turn2: [
                        { label: 'A', text: '各立場の意見を踏まえ、段階的導入と教育的サポートの組み合わせが最善策だと結論づけます。' },
                        { label: 'B', text: 'Cの柔軟なアプローチとDの連携モデルを組み合わせることで、リスクを最小化できると考えます。' },
                        { label: 'C', text: '全員の意見に共通する「ルールと教育の重要性」を軸に、現実的な実装方法を検討すべきです。' },
                        { label: 'D', text: 'この議論で明らかになった多角的な視点を保護者や地域への啓発活動に活かすべきです。' },
                    ]
                },
                finalSummary: '本議論を通じて、授業へのスマホ持ち込みは単純な賛否ではなく、年齢・環境・サポート体制によって判断すべき複合的な問題であることが明らかになりました。完全禁止でも無制限許可でもなく、教科別ルール・フィルタリング・保護者連携を組み合わせた段階的導入が最も現実的な解決策として浮かび上がりました。'
            },
            assumptionDebateLog: [
                {
                    id: 'assumption_0',
                    content: '中学生は自己管理が難しい',
                    dependsOn: ['B'],
                    invalidationScore: 0.45,
                    invalidated: false,
                    gammaUtterances: [
                        { label: 'A', text: '自己管理能力は個人差が大きく、年齢だけで一般化するのは困難です。' },
                        { label: 'C', text: '適切な教育環境があれば中学生でも十分な自己管理が可能という事例があります。' },
                    ]
                }
            ],
            mindmap1: '',
            mindmap2: '',
        }
    });
});

router.post('/start/debug', (req, res) => {
    res.json({
            phase1: [
                { label: 'A', text: 'スマホは学習ツールとして有効です。調べ学習や辞書として活用でき、学習効率が向上します。' },
                { label: 'B', text: 'スマホは集中力を妨げます。SNSやゲームへの誘惑があり、授業に集中できなくなります。' },
                { label: 'C', text: '場面に応じた柔軟な判断が必要です。一律の禁止や許可より状況に応じた使い分けが現実的です。' },
                { label: 'D', text: '保護者や地域社会も含めた幅広い議論が必要です。家庭環境にも依存する問題です。' },
            ],
            phase2: {
                research: [
                    { label: 'A', text: '文部科学省の調査によると、ICT活用授業では理解度が15%向上したという結果があります。' },
                    { label: 'B', text: 'スマホ使用と学力低下の相関を示す研究が複数存在します。特に中学生で顕著です。' },
                    { label: 'C', text: '海外では教科ごとに使用ルールを設ける学校が増えており、成果を上げています。' },
                    { label: 'D', text: '保護者の72%がスマホの学校持ち込みについてルールの明確化を求めています。' },
                ],
                credibility: '各エージェントの情報は概ね信頼性が高いと判断されます。ただしAとBの主張は相反しており、文脈依存性が高い点に注意が必要です。',
                rebuttals: [
                    { attacker: 'A', defender: 'B', text: 'BはSNSへの誘惑を指摘していますが、適切なフィルタリングとルール設定で対処可能です。' },
                    { attacker: 'B', defender: 'A', text: 'Aは学習効率向上を主張しますが、自己管理能力が低い生徒には逆効果になる可能性があります。' },
                    { attacker: 'C', defender: 'A', text: 'Aの主張は全教科への一律適用を前提としており、場面依存性を考慮していません。' },
                    { attacker: 'D', defender: 'C', text: 'Cの提案は理想的ですが、学校単独での決定では保護者との乖離が生じる恐れがあります。' },
                ],
                subTopics: [
                    { id: 'sub_0', title: '自己管理能力と年齢の関係', reason: '反論で繰り返し登場した論点', depth: 0 },
                    { id: 'sub_1', title: 'フィルタリング技術の実効性', reason: 'スマホ使用を認める前提条件として重要', depth: 0 },
                ],
                decomposition: {
                    '自己管理能力と年齢の関係': {
                        mainPoints: ['中学生は自己管理が難しい', '高校生は自律的に判断できる'],
                        evidence: ['発達心理学の知見'],
                        valuePremises: ['自律性の尊重', '教育的保護'],
                    }
                }
            },
            phase3: [
                {
                    subTopic: { id: 'sub_0', title: '自己管理能力と年齢の関係', depth: 0 },
                    discussionLog: [
                        {
                            turn: 1, subStep: 'α',
                            utterances: [
                                { label: 'A', text: '年齢よりも個人差の方が大きいと考えます。一律に年齢で判断するのは適切ではありません。' },
                                { label: 'B', text: '発達心理学的に見て、前頭前野の発達は18歳頃まで続くため、中学生の自己管理には限界があります。' },
                            ]
                        },
                        {
                            turn: 1, subStep: 'β',
                            utterances: [
                                { label: 'A', text: 'Bの指摘は理解できますが、だからこそ学校がサポートしながらスマホの使い方を教える機会にすべきです。' },
                                { label: 'B', text: 'サポート体制が整っていない現状では、リスクを先に排除すべきです。' },
                            ]
                        }
                    ],
                    subSubTopics: []
                },
                {
                    subTopic: { id: 'sub_1', title: 'フィルタリング技術の実効性', depth: 0 },
                    discussionLog: [
                        {
                            turn: 1, subStep: 'α',
                            utterances: [
                                { label: 'A', text: '現在のフィルタリング技術は高度に発展しており、SNSやゲームを効果的にブロックできます。' },
                                { label: 'C', text: 'フィルタリングの抜け道は常に存在し、技術的な解決策には限界があります。' },
                            ]
                        }
                    ],
                    subSubTopics: []
                }
            ],
            phase4: {
                synthesis: {
                    turn1: [
                        { label: 'A', text: '議論を通じて、スマホの有効活用には適切なルールと教育が不可欠だという認識を深めました。' },
                        { label: 'B', text: '完全禁止より段階的な導入の方が現実的だと考えを修正しました。ただし十分なサポート体制が前提です。' },
                        { label: 'C', text: '教科ごとの使用ルール設定と保護者との合意形成を組み合わせるアプローチを支持します。' },
                        { label: 'D', text: '学校・家庭・地域が連携したガイドライン策定が最も重要だという立場を維持します。' },
                    ],
                    turn2: [
                        { label: 'A', text: '各立場の意見を踏まえ、段階的導入と教育的サポートの組み合わせが最善策だと結論づけます。' },
                        { label: 'B', text: 'Cの柔軟なアプローチとDの連携モデルを組み合わせることで、リスクを最小化できると考えます。' },
                        { label: 'C', text: '全員の意見に共通する「ルールと教育の重要性」を軸に、現実的な実装方法を検討すべきです。' },
                        { label: 'D', text: 'この議論で明らかになった多角的な視点を保護者や地域への啓発活動に活かすべきです。' },
                    ]
                },
                finalSummary: '本議論を通じて、授業へのスマホ持ち込みは単純な賛否ではなく、年齢・環境・サポート体制によって判断すべき複合的な問題であることが明らかになりました。完全禁止でも無制限許可でもなく、教科別ルール・フィルタリング・保護者連携を組み合わせた段階的導入が最も現実的な解決策として浮かび上がりました。'
            },
            assumptionDebateLog: [
                {
                    id: 'assumption_0',
                    content: '中学生は自己管理が難しい',
                    dependsOn: ['B'],
                    invalidationScore: 0.45,
                    invalidated: false,
                    gammaUtterances: [
                        { label: 'A', text: '自己管理能力は個人差が大きく、年齢だけで一般化するのは困難です。' },
                        { label: 'C', text: '適切な教育環境があれば中学生でも十分な自己管理が可能という事例があります。' },
                    ]
                }
            ],
            mindmap1: '',
            mindmap2: '',
    });
});

router.get('/result/:roomId', (req, res) => {
    const result = roomResults[req.params.roomId];
    if (!result) return res.json({ ready: false });
    res.json({ ready: true, result });
});

module.exports = router;
