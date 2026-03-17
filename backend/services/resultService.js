/**
 * resultService.js
 * フェーズ4ステップ2の最終まとめプロンプト生成と実行を担う
 */

const { callGeminiWithRetry } = require('./geminiClient');

/**
 * フェーズ4ステップ2: 最終まとめプロンプト生成
 * @param {string} topic - 議題
 * @param {Array} agents - 全エージェント情報
 * @param {object} decomposition - 要素分解結果
 * @param {Array<{title: string, conclusion: string}>} subTopicConclusions - 全サブ議題の結論
 * @param {object} synthesisRound - 統合表明ラウンドの発言（turn1, turn2）
 * @returns {string} プロンプト文字列
 */
const buildFinalSummaryPrompt = (topic, agents, decomposition, subTopicConclusions, synthesisRound) => {
    const agentList = agents.map(a => `- ${a.label}: ${a.coreClaim}`).join('\n');

    const decompositionText = Object.entries(decomposition || {})
        .map(([label, data]) => {
            const points = (data.mainPoints || []).join('、');
            const evidence = (data.evidence || []).join('、');
            const values = (data.valuePremises || []).join('、');
            return `${label}: 論点[${points}] 根拠[${evidence}] 価値前提[${values}]`;
        }).join('\n');

    const conclusionText = (subTopicConclusions || [])
        .map(s => `【${s.title}】\n${s.conclusion}`)
        .join('\n\n');

    const turn1Text = (synthesisRound.turn1 || [])
        .map(u => `${u.label}: ${u.text}`)
        .join('\n\n');

    const turn2Text = (synthesisRound.turn2 || [])
        .map(u => `${u.label}: ${u.text}`)
        .join('\n\n');

    return `あなたは中立的な議論総括AIです。
以下の情報を基に、議論の最終総括を行ってください。

【議題】
${topic}

【各アイデアの主張】
${agentList}

【要素分解結果】
${decompositionText}

【各サブ議題の結論】
${conclusionText}

【統合表明ターン1】
${turn1Text}

【統合表明ターン2】
${turn2Text}

【出力形式】
以下の3つの見出しで構成された分析を出力すること：

解決済み争点
（この議論で合意に至った点や、一方の主張が明確に優位であると示された点を記述する）

妥協案が成立する領域
（両者の主張が部分的に両立しうる領域、条件付きで合意できる点を記述する）

人間が最終判断すべき残存論点
（AIの議論では解決できない価値観の対立や、追加の実証データが必要な論点を記述する）

【制約】
- 感情や修辞を排除し、論理構造のみで分析すること
- マークダウン記法のアスタリスク（*）、ハイフン（-）のリスト記号、スラッシュ（/）を一切使わないこと
- 自然な日本語文章で出力すること`;
};

/**
 * 最終まとめをAIに実行させる
 * @param {string} topic
 * @param {Array} agents
 * @param {object} decomposition
 * @param {Array} subTopicConclusions
 * @param {object} synthesisRound
 * @returns {Promise<string>} 総括テキスト
 */
const runFinalSummary = async (topic, agents, decomposition, subTopicConclusions, synthesisRound) => {
    const prompt = buildFinalSummaryPrompt(topic, agents, decomposition, subTopicConclusions, synthesisRound);
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    return result || '（最終総括を生成できませんでした）';
};

module.exports = {
    buildFinalSummaryPrompt,
    runFinalSummary,
};
