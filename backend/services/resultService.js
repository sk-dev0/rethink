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

/**
 * マインドマップ用Markdownプロンプト生成
 */
const parseFinalSummary = (text) => {
    // Split by section markers; handles content both on same line and next line
    const parts = text.split(/見出し[1-9][：:]/);
    // parts[0]: preamble, parts[1]: 見出し1 content, parts[2]: 見出し2, parts[3]: 見出し3

    const extractContent = (raw) => {
        if (!raw) return '';
        const t = raw.trim();
        // First line is the section title (e.g. "解決済み争点") — skip it if content follows
        const nl = t.indexOf('\n');
        const content = nl >= 0 ? t.slice(nl + 1).trim() : t;
        return content.slice(0, 300);
    };

    return {
        settled: extractContent(parts[1]),
        compromise: extractContent(parts[2]),
        remaining: extractContent(parts[3]),
    };
};

/**
 * テキスト配列を Gemini で一括20字要約する
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
const summarizeLabels = async (texts) => {
    if (texts.length === 0) return [];
    const prompt = `以下のテキストをそれぞれ20字以内の日本語に要約せよ。
必ずJSON配列形式のみを出力せよ。コードブロックや説明文は一切不要。入力と同じ順序・個数で返すこと。

${texts.map((t, i) => `[${i}]: ${t.slice(0, 300)}`).join('\n')}

出力例（3件）: ["要約1", "要約2", "要約3"]`;
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const raw = await callGeminiWithRetry(contents);
    try {
        const cleaned = (raw || '').replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length === texts.length) return parsed;
    } catch (_) {}
    // フォールバック: 機械的に切り捨て
    return texts.map(t => {
        const s = (t || '').replace(/[\r\n]+/g, ' ').trim();
        return s.length > 18 ? s.slice(0, 17) + '…' : s;
    });
};

/**
 * mermaid graph LR コードをデータから生成する
 * 構造はプログラムで確定し、ラベルのみ Gemini で20字要約する
 * @param {string} topic
 * @param {Array} agents
 * @param {object} result
 * @returns {Promise<string>} mermaid コード
 */
const buildMindmapCode = async (topic, agents, result) => {
    const phase3 = result.phase3 || [];
    const rebuttals = result.phase2?.rebuttals || [];
    const { settled, compromise, remaining } = parseFinalSummary(result.phase4?.finalSummary || '');

    const extractPoints = (text) => {
        const pts = text.split(/[。\n]/).map(s => s.trim()).filter(s => s.length > 2).slice(0, 3);
        return pts.length > 0 ? pts : (text.trim() ? [text.trim()] : []);
    };
    const settledPts = extractPoints(settled);
    const compromisePts = extractPoints(compromise);
    const remainingPts = extractPoints(remaining);

    // 要約が必要なテキストを順番に収集
    const rawConclusions = phase3.map(r => {
        const lastTurn = r.discussionLog[r.discussionLog.length - 1];
        return (lastTurn?.utterances || []).map(u => u.text).join(' ') || `${r.subTopic.title}の結論`;
    });

    const textsToSummarize = [
        topic,
        ...agents.map(a => a.coreClaim),
        ...agents.map(a => a.rationale),
        ...rawConclusions,
        ...settledPts,
        ...compromisePts,
        ...remainingPts,
    ];

    const summaries = await summarizeLabels(textsToSummarize);
    let idx = 0;
    const next = () => summaries[idx++] || '';

    const safe = (text) => (text || '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim();
    const lines = ['graph LR'];
    const addNode = (id, text) => lines.push(`  ${id}["${safe(text)}"]`);
    const addEdge = (from, to) => lines.push(`  ${from} --> ${to}`);

    // 議題
    addNode('n0', next());

    // アイデア（意見・根拠）
    const claimSummaries = agents.map(() => next());
    const reasonSummaries = agents.map(() => next());
    agents.forEach((agent, i) => {
        const ch = String.fromCharCode(65 + i);
        addNode(`idea${ch}`, `${agent.label}: ${claimSummaries[i]}`);
        addNode(`reason${ch}`, reasonSummaries[i]);
        addEdge('n0', `idea${ch}`);
        addEdge(`idea${ch}`, `reason${ch}`);
    });

    // 反論ノード（attacker→defender 表記は既に短い）
    rebuttals.forEach((r, i) => {
        addNode(`reb${i}`, `${r.attacker}→${r.defender}`);
        const attackerIdx = agents.findIndex(a => a.label === r.attacker);
        const fromId = attackerIdx >= 0
            ? `reason${String.fromCharCode(65 + attackerIdx)}`
            : 'n0';
        addEdge(fromId, `reb${i}`);
    });

    // サブ議題・サブサブ議題（タイトルは既に短い）
    const nodeIdMap = {};
    const depth0 = phase3.filter(r => r.subTopic.depth === 0);
    const depthN = phase3.filter(r => r.subTopic.depth > 0)
        .sort((a, b) => a.subTopic.depth - b.subTopic.depth);

    depth0.forEach((r, i) => {
        nodeIdMap[r.subTopic.id] = `sub${i}`;
        addNode(`sub${i}`, r.subTopic.title);
        const rebId = rebuttals.length > 0 ? `reb${i % rebuttals.length}` : 'n0';
        addEdge(rebId, `sub${i}`);
    });
    depthN.forEach((r, i) => {
        nodeIdMap[r.subTopic.id] = `ss${i}`;
        addNode(`ss${i}`, r.subTopic.title);
        addEdge(nodeIdMap[r.subTopic.parentId] || 'n0', `ss${i}`);
    });

    // サブ議題結論（要約済み）→ 必ず summary に収束
    const conSummaries = phase3.map(() => next());
    phase3.forEach((r, i) => {
        addNode(`con${i}`, conSummaries[i]);
        addEdge(nodeIdMap[r.subTopic.id] || 'n0', `con${i}`);
        addEdge(`con${i}`, 'summary');
    });

    // 最終まとめ
    addNode('summary', '最終まとめ');
    addNode('settled', '解決済み争点');
    addNode('compromise', '妥協が成立する領域');
    addNode('remaining', '残存する対立');
    addEdge('summary', 'settled');
    addEdge('summary', 'compromise');
    addEdge('summary', 'remaining');

    // 詳細ノード（要約済み）
    settledPts.forEach((_, i) => { addNode(`s${i}`, next()); addEdge('settled', `s${i}`); });
    compromisePts.forEach((_, i) => { addNode(`c${i}`, next()); addEdge('compromise', `c${i}`); });
    remainingPts.forEach((_, i) => { addNode(`r${i}`, next()); addEdge('remaining', `r${i}`); });

    return lines.join('\n');
};

module.exports = {
    buildFinalSummaryPrompt,
    runFinalSummary,
    buildMindmapCode,
};
