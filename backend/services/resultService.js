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

    return `あなたは議論の構造分析を専門とする中立的なモデレーターである。
以下の情報を元に、感情・修辞を排除して論理構造のみで分析せよ。感想・評価・応援は一切禁止する。

【議題】
以下の議題を分析の前提として使用すること。
${topic}

【各アイデアの主張】
以下の各主張を出力の3セクションにおける論点整理の基軸として使用すること。
${agentList}

【要素分解結果】
以下の要素分解結果を見出し2の妥協案生成に活用し、各アイデアの要素を組み合わせた現実的な妥協案を導出すること。
${decompositionText || '（要素分解なし）'}

【各サブ議題の結論】
以下の各サブ議題の結論を参照し、見出し1の解決済み争点と見出し3の残存論点の判定根拠として使用すること。
${conclusionText}

【統合表明ターン1】
以下の各エージェントの独立した統合表明を参照し、各アイデアが維持した主張と譲歩した点を見出し1・見出し2の分析に活用すること。
${turn1Text}

【統合表明ターン2】
以下の各エージェントの相互参照後の統合表明を参照し、ターン1からの変化を見出し2・見出し3の分析に活用すること。
${turn2Text}

---

以下の3セクションを順番に、見出しを明記した上で出力せよ。

見出し1: 解決済み争点
議論を通じて決着がついた論点を列挙せよ。

見出し2: 妥協案が成立する領域
アイデアの要素分解結果を活用し、各アイデアの要素を組み合わせた現実的な妥協案を提示せよ。

見出し3: 人間が最終判断すべき残存論点
AI議論では決着がつかなかった、価値判断を伴う論点を列挙せよ。

【制約】
- マークダウン記法（アスタリスク、ハイフンのリスト記号、スラッシュ）を一切使用せず、自然な日本語文章として出力せよ。`;
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
