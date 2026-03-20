/**
 * mindmapService.js
 * mermaid.js graph LR 形式のマインドマップコード生成
 *
 * 構成
 *  Section 1: 定数・共有ヘルパー
 *  Section 2: Gemini データ抽出器
 *  Section 3: スタイル定義
 *  Section 4: グラフ組み立て（mindmap1 / mindmap2）
 *  Section 5: エントリポイント
 */

'use strict';

const { callGeminiWithRetry } = require('./geminiClient');
const {
    MINDMAP_LABEL_MAX_CHARS,
    MINDMAP_SUBTOPIC_MAX_CHARS,
    MINDMAP_INTEGRATION_MAX_CHARS,
} = require('./constants');

// ============================================================
// Section 1: 定数・共有ヘルパー
// ============================================================

/**
 * ノード種別ごとの文字数上限を返す
 * constants.js の MINDMAP_*_MAX_CHARS を参照
 * @param {'label'|'subtopic'|'integration'} type
 * @returns {number}
 */
const getCharLimit = (type) => ({
    label:       MINDMAP_LABEL_MAX_CHARS,
    subtopic:    MINDMAP_SUBTOPIC_MAX_CHARS,
    integration: MINDMAP_INTEGRATION_MAX_CHARS,
})[type] ?? MINDMAP_LABEL_MAX_CHARS;

/**
 * Mermaid ノードラベルを安全な文字列に変換
 * （ダブルクォートと改行を除去）
 */
const safe = (text) =>
    (text || '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim();

/**
 * JSON レスポンスのコードブロックを除去してパース
 * @returns {*|null} パース成功時はオブジェクト、失敗時は null
 */
const parseJsonResponse = (raw) => {
    try {
        const cleaned = (raw || '').replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (_) {
        return null;
    }
};

/**
 * graph LR ビルダーファクトリ
 * addNode / addEdge / addClassDef を提供し、build() で mermaid コードを返す
 */
const createGraphBuilder = () => {
    const lines = ['graph LR'];
    return {
        addClassDef: (name, style) => lines.push(`  classDef ${name} ${style}`),
        addNode:     (id, text, cls) =>
            lines.push(`  ${id}["${safe(text)}"]${cls ? `:::${cls}` : ''}`),
        addEdge:     (from, to) => lines.push(`  ${from} --> ${to}`),
        build:       () => lines.join('\n'),
    };
};

// ============================================================
// Section 2: Gemini データ抽出器
// ============================================================

/**
 * 最終総括テキストを3セクションに分割（3段階フォールバック付き）
 * @returns {{ settled: string, compromise: string, remaining: string }}
 */
const parseFinalSummary = (text) => {
    const parts = text.split(/見出し[1-9][：:]/);
    const extractContent = (raw) => {
        if (!raw) return '';
        const t = raw.trim();
        const nl = t.indexOf('\n');
        return (nl >= 0 ? t.slice(nl + 1).trim() : t).slice(0, 500);
    };

    let settled    = extractContent(parts[1]);
    let compromise = extractContent(parts[2]);
    let remaining  = extractContent(parts[3]);

    if (!settled)
        settled    = text.match(/解決済み争点[^\n]*\n([\s\S]*?)(?=妥協|残存|人間が|$)/)?.[1]?.trim().slice(0, 500) || '';
    if (!compromise)
        compromise = text.match(/妥協[^\n]*\n([\s\S]*?)(?=残存|人間が|$)/)?.[1]?.trim().slice(0, 500) || '';
    if (!remaining)
        remaining  = text.match(/残存[^\n]*\n([\s\S]*?)$|人間が[^\n]*\n([\s\S]*?)$/)?.[1]?.trim().slice(0, 500) || '';

    if (!settled && !compromise && !remaining && text.trim()) {
        const chunk = Math.ceil(text.length / 3);
        settled    = text.slice(0, chunk).trim();
        compromise = text.slice(chunk, chunk * 2).trim();
        remaining  = text.slice(chunk * 2).trim();
    }
    return { settled, compromise, remaining };
};

/**
 * まとめ3セクションから具体的な名詞句を Gemini で抽出
 * @returns {Promise<{ settled: string[], compromise: string[], remaining: string[] }>}
 */
const extractSectionPoints = async (settled, compromise, remaining) => {
    if (!settled && !compromise && !remaining)
        return { settled: [], compromise: [], remaining: [] };

    const limit = getCharLimit('label');
    const prompt =
`以下の3セクションのテキストから，それぞれ最重要な具体的な争点・案・論点を2〜3個抽出せよ。
各項目は${limit}字以内の名詞句とし，"議論が行われた"や"以下に示す"のような説明・導入文は絶対に使わないこと。
パッと見ただけで内容が伝わる具体的な言葉にすること。必ずJSON形式のみで返すこと。

解決済み争点セクション:
${(settled || '（なし）').slice(0, 500)}

妥協案セクション:
${(compromise || '（なし）').slice(0, 500)}

残存論点セクション:
${(remaining || '（なし）').slice(0, 500)}

出力形式（例）:
{"settled":["UI簡素化で合意","ターゲット層の定義"],"compromise":["基本機能共通化","上位機能オプション"],"remaining":["費用負担の配分","価値観の優先度"]}`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (parsed) {
        return {
            settled:    (Array.isArray(parsed.settled)    ? parsed.settled    : []).slice(0, 3),
            compromise: (Array.isArray(parsed.compromise) ? parsed.compromise : []).slice(0, 3),
            remaining:  (Array.isArray(parsed.remaining)  ? parsed.remaining  : []).slice(0, 3),
        };
    }
    // フォールバック: 文単位で分割して最初の2〜3句
    const fb = (t) =>
        (t || '').split(/[。\n]/).map(s => s.trim()).filter(s => s.length > 4 && s.length <= 30).slice(0, 3);
    return { settled: fb(settled), compromise: fb(compromise), remaining: fb(remaining) };
};

/**
 * 各サブ議題の議論内容を Gemini で要約
 * 文字数上限は getCharLimit('subtopic')
 * @param {Array} phase3 - debateEngine の phase3Results
 * @returns {Promise<string[]>}
 */
const extractSubtopicSummaries = async (phase3) => {
    if (phase3.length === 0) return [];
    const limit = getCharLimit('subtopic');

    const discussions = phase3.map((r, i) => {
        const lastTurn  = r.discussionLog[r.discussionLog.length - 1];
        const utterances = lastTurn?.utterances || [];
        const text = utterances.map(u => `${u.label}: ${u.text.slice(0, 150)}`).join('\n');
        return `[${i}] サブ議題:${r.subTopic.title}\n${text || '（発言なし）'}`;
    });

    const prompt =
`以下のサブ議題ごとの議論（最終ターン）を読み，各サブ議題での議論内容を${limit}字以内の日本語で要約せよ。
"〇〇と〇〇が対立"や"〇〇の方向で概ね合意"のような具体的な内容にすること。説明文・導入文は不可。
必ずJSON配列形式のみを出力せよ。コードブロック不要。入力と同じ順序・個数で返すこと。

${discussions.map(d => d.slice(0, 500)).join('\n\n')}

出力例（2件）: ["UIとコストのトレードオフを中心に議論", "機能絞り込みの方向で概ね合意"]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed) && parsed.length === phase3.length) return parsed;

    return phase3.map(r => (r.subTopic.title || '').slice(0, limit - 1) + '…');
};

/**
 * 各サブ議題に最も意味的に近い反論インデックスを Gemini でマッチング
 * マッチしない場合は -1（= n0 直結）
 * @returns {Promise<number[]>} phase3 と同順の rebuttal インデックス配列
 */
const matchRebuttalToSubtopics = async (rebuttals, phase3) => {
    if (rebuttals.length === 0 || phase3.length === 0)
        return phase3.map(() => -1);

    const rebList = rebuttals.map((r, i) =>
        `[${i}] ${r.attacker}→${r.defender}: ${r.text.slice(0, 100)}`
    ).join('\n');
    const subList = phase3.map((r, i) =>
        `[${i}] ${r.subTopic.title}`
    ).join('\n');

    const prompt =
`以下の反論リストとサブ議題リストを照合し，各サブ議題に最も内容が近い反論のインデックスを答えよ。
対応する反論がない・関連が薄い場合は -1 を返すこと。
必ずJSON配列形式のみを出力せよ。コードブロック不要。サブ議題と同じ順序・個数で返すこと。

【反論リスト】
${rebList}

【サブ議題リスト】
${subList}

出力例（サブ議題3件）: [0, 2, -1]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed) && parsed.length === phase3.length) {
        return parsed.map(idx =>
            typeof idx === 'number' && idx >= 0 && idx < rebuttals.length ? idx : -1
        );
    }
    // フォールバック: modulo接続
    return phase3.map((_, i) => i % rebuttals.length);
};

/**
 * 各エージェントの統合表明1・2から
 * 維持 / 譲歩 / 残存対立点 と turn2 での展開を Gemini で抽出
 * 文字数上限は getCharLimit('integration')
 *
 * @param {Array}  agents    - エージェント配列
 * @param {Array}  turn1Data - [{label, text}]
 * @param {Array}  turn2Data - [{label, text}]
 * @returns {Promise<Array<{maintain,concede,conflict,t2_maintain,t2_concede,t2_conflict}>>}
 */
const extractIntegrationStructure = async (agents, turn1Data, turn2Data) => {
    if (agents.length === 0) return [];
    const limit = getCharLimit('integration');

    const items = agents.map((agent, i) => {
        const t1 = turn1Data.find(u => u.label === agent.label)?.text || '';
        const t2 = turn2Data.find(u => u.label === agent.label)?.text || '';
        return `[${i}] ${agent.label}\n統合表明1: ${t1.slice(0, 400)}\n統合表明2: ${t2.slice(0, 400)}`;
    });

    const prompt =
`以下のエージェントごとの統合表明1と統合表明2を読み，各エージェントについて以下6項目を${limit}字以内で抽出せよ。
maintain:   統合表明1で「維持・堅持している主張」を具体的に
concede:    統合表明1で「譲歩・妥協している点」を具体的に
conflict:   統合表明1で「残存する対立点」を具体的に
t2_maintain: 統合表明2での「維持点のその後の展開・変化」
t2_concede:  統合表明2での「譲歩点のその後の展開・変化」
t2_conflict: 統合表明2での「残存対立点のその後の動向」

説明文・導入文は不可。パッと見てわかる具体的な言葉にすること。
必ずJSON配列形式のみを出力。コードブロック不要。入力と同じ順序・個数で返すこと。

${items.join('\n\n')}

出力例（2エージェント）:
[{"maintain":"UI簡素化を堅持","concede":"機能数を削減","conflict":"コスト負担の配分","t2_maintain":"UI原則は維持確認","t2_concede":"削減幅を縮小提案","t2_conflict":"配分比率は未決"},{"maintain":"機能充実を主張","concede":"段階的リリース受入","conflict":"品質基準の定義","t2_maintain":"充実方針を再確認","t2_concede":"段階案を精緻化","t2_conflict":"品質指標で交渉継続"}]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed) && parsed.length === agents.length) return parsed;

    // フォールバック
    return agents.map(agent => ({
        maintain:    `${agent.label}が維持`,
        concede:     `${agent.label}が譲歩`,
        conflict:    `${agent.label}の残存対立点`,
        t2_maintain: '維持点の展開',
        t2_concede:  '譲歩点の展開',
        t2_conflict: '残存点の動向',
    }));
};

/**
 * テキスト配列を Gemini で一括要約
 * @param {string[]} texts
 * @param {number}   maxChars - 省略時は getCharLimit('label')
 * @returns {Promise<string[]>}
 */
const summarizeLabels = async (texts, maxChars = getCharLimit('label')) => {
    if (texts.length === 0) return [];

    const prompt =
`以下のテキストをそれぞれ${maxChars}字以内の日本語に要約せよ。
必ずJSON配列形式のみを出力せよ。コードブロックや説明文は一切不要。入力と同じ順序・個数で返すこと。

${texts.map((t, i) => `[${i}]: ${(t || '').slice(0, 300)}`).join('\n')}

出力例（3件）: ["要約1", "要約2", "要約3"]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed) && parsed.length === texts.length) return parsed;

    return texts.map(t => {
        const s = (t || '').replace(/[\r\n]+/g, ' ').trim();
        return s.length > maxChars - 1 ? s.slice(0, maxChars - 1) + '…' : s;
    });
};

// ============================================================
// Section 3: スタイル定義
// ============================================================

/** classDef スタイル文字列の一覧 */
const CLASS_STYLES = {
    red:   'fill:#fff,stroke:#dc3545,stroke-width:1.5px,color:#212529',
    blue:  'fill:#fff,stroke:#0d6efd,stroke-width:1.5px,color:#212529',
    green: 'fill:#fff,stroke:#198754,stroke-width:1.5px,color:#212529',
    conn:  'fill:#f8f9fa,stroke:#6c757d,stroke-width:1.5px,stroke-dasharray:4 2,color:#6c757d',
};

/** ビルダーに指定クラスの classDef を一括追加 */
const applyClassDefs = (builder, ...classNames) =>
    classNames.forEach(name => builder.addClassDef(name, CLASS_STYLES[name]));

// ============================================================
// Section 4: グラフ組み立て
// ============================================================

/**
 * マインドマップ①: 議論フェーズ
 * 議題 → アイデア/理由 → 反論（意味マッチング）↔ サブ議題 → サブ議題要約 → 継続コネクタ
 *
 * 色: 赤（議題〜反論） / 青（サブ議題〜要約） / conn（継続コネクタ）
 */
const buildMindmap1Code = async (topic, agents, result) => {
    const phase3    = result.phase3 || [];
    const rebuttals = result.phase2?.rebuttals || [];

    // 並列データ取得（各グループが独立した配列のため index ずれなし）
    const [
        conSummaries,
        rebuttalMatches,
        topicSums,
        claimSums,
        reasonSums,
        rebuttalSums,
    ] = await Promise.all([
        extractSubtopicSummaries(phase3),
        matchRebuttalToSubtopics(rebuttals, phase3),
        summarizeLabels([topic],                          getCharLimit('label')),
        summarizeLabels(agents.map(a => a.coreClaim),     getCharLimit('label')),
        summarizeLabels(agents.map(a => a.rationale),     getCharLimit('label')),
        rebuttals.length > 0
            ? summarizeLabels(rebuttals.map(r => r.text), getCharLimit('label'))
            : Promise.resolve([]),
    ]);

    const b = createGraphBuilder();
    applyClassDefs(b, 'red', 'blue', 'conn');

    // ── 議題（赤）──
    b.addNode('n0', topicSums[0] || topic.slice(0, getCharLimit('label') - 1), 'red');

    // ── アイデア・理由（赤）──
    // エージェントID は数値インデックスベース（A-Z 依存なし）
    agents.forEach((agent, i) => {
        b.addNode(`agent_${i}`, `${agent.label}: ${claimSums[i] || ''}`, 'red');
        b.addNode(`reason_${i}`, reasonSums[i] || '', 'red');
        b.addEdge('n0',        `agent_${i}`);
        b.addEdge(`agent_${i}`, `reason_${i}`);
    });

    // ── 反論（赤）: defender の reason から出る ──
    rebuttals.forEach((r, i) => {
        const defenderIdx = agents.findIndex(a => a.label === r.defender);
        const fromId = defenderIdx >= 0 ? `reason_${defenderIdx}` : 'n0';
        b.addNode(`reb${i}`, `${r.attacker}→${r.defender}: ${rebuttalSums[i] || ''}`, 'red');
        b.addEdge(fromId, `reb${i}`);
    });

    // ── サブ議題・サブサブ議題（青）──
    // rebuttalMatches[i] === -1 のサブ議題は n0 に直結
    const nodeIdMap = {};
    const depth0 = phase3.filter(r => r.subTopic.depth === 0);
    const depthN = phase3
        .filter(r => r.subTopic.depth > 0)
        .sort((a, b) => a.subTopic.depth - b.subTopic.depth);

    depth0.forEach((r, i) => {
        const nid    = `sub${i}`;
        const rebIdx = rebuttalMatches[i];  // -1 or valid index
        nodeIdMap[r.subTopic.id] = nid;
        b.addNode(nid, r.subTopic.title, 'blue');
        b.addEdge(rebIdx >= 0 ? `reb${rebIdx}` : 'n0', nid);
    });

    depthN.forEach((r, i) => {
        const nid = `ss${i}`;
        nodeIdMap[r.subTopic.id] = nid;
        b.addNode(nid, r.subTopic.title, 'blue');
        // parentId 未登録なら depth0 の最近傍へフォールバック
        const parentNid = nodeIdMap[r.subTopic.parentId]
            || (depth0.length > 0 ? `sub${i % depth0.length}` : 'n0');
        b.addEdge(parentNid, nid);
    });

    // ── サブ議題の要約（青・葉ノード）──
    const leafIds = [];
    phase3.forEach((r, i) => {
        const parentNid = nodeIdMap[r.subTopic.id];
        if (!parentNid) return;
        const conId = `con${i}`;
        b.addNode(conId, conSummaries[i] || '', 'blue');
        b.addEdge(parentNid, conId);
        leafIds.push(conId);
    });

    // ── 継続コネクタ（右端）──
    b.addNode('cont1', '→ 統合フェーズへ', 'conn');
    (leafIds.length > 0 ? leafIds : ['n0']).forEach(lid => b.addEdge(lid, 'cont1'));

    return b.build();
};

/**
 * マインドマップ②: 統合フェーズ
 *
 * 構造（エージェントごと）:
 *   [継続コネクタ]
 *     → [〇の統合表明]
 *         → [〇〇を維持]  → [turn2 維持展開] ─┐
 *         → [〇〇を譲歩]  → [turn2 譲歩展開] ─┼→ [まとめ（収束）]
 *         → [〇〇残存対立] → [turn2 残存展開] ─┘
 *   [まとめ（収束）] → settled / compromise / remaining
 *
 * 色: 青（統合表明） / 緑（まとめ以降） / conn（継続コネクタ）
 */
const buildMindmap2Code = async (agents, result) => {
    const phase4    = result.phase4 || {};
    const synthesis = phase4.synthesis || {};
    const turn1Data = synthesis.turn1 || [];
    const turn2Data = synthesis.turn2 || [];
    const { settled, compromise, remaining } = parseFinalSummary(phase4.finalSummary || '');

    const [sectionPoints, integrationStructure] = await Promise.all([
        extractSectionPoints(settled, compromise, remaining),
        extractIntegrationStructure(agents, turn1Data, turn2Data),
    ]);

    const b = createGraphBuilder();
    applyClassDefs(b, 'blue', 'green', 'conn');

    // ── 継続コネクタ（左端）──
    b.addNode('prev2', '議論フェーズより →', 'conn');

    // ── 各エージェントの統合表明ツリー（青）──
    agents.forEach((agent, i) => {
        const s      = integrationStructure[i] || {};
        const stmtId = `stmt_${i}`;   // 〇の統合表明
        const maintId = `maint_${i}`; // 〇〇を維持
        const concId  = `conc_${i}`;  // 〇〇を譲歩
        const conflId = `conf_${i}`;  // 〇〇が残存する対立点
        const t2MId   = `t2m_${i}`;   // turn2: 維持展開
        const t2CnId  = `t2cn_${i}`;  // turn2: 譲歩展開
        const t2CfId  = `t2cf_${i}`;  // turn2: 残存展開

        b.addNode(stmtId, `${agent.label}の統合表明`, 'blue');
        b.addNode(maintId, s.maintain || `${agent.label}が維持`,    'blue');
        b.addNode(concId,  s.concede  || `${agent.label}が譲歩`,    'blue');
        b.addNode(conflId, s.conflict || `${agent.label}の残存対立点`, 'blue');
        b.addNode(t2MId,   s.t2_maintain || '', 'blue');
        b.addNode(t2CnId,  s.t2_concede  || '', 'blue');
        b.addNode(t2CfId,  s.t2_conflict || '', 'blue');

        b.addEdge('prev2',  stmtId);
        b.addEdge(stmtId,   maintId);
        b.addEdge(stmtId,   concId);
        b.addEdge(stmtId,   conflId);
        b.addEdge(maintId,  t2MId);
        b.addEdge(concId,   t2CnId);
        b.addEdge(conflId,  t2CfId);
        b.addEdge(t2MId,   'summary');
        b.addEdge(t2CnId,  'summary');
        b.addEdge(t2CfId,  'summary');
    });

    // ── まとめ（収束）以降（緑）──
    b.addNode('summary',    'まとめ（収束）',    'green');
    b.addNode('settled',    '解決済み争点',      'green');
    b.addNode('compromise', '妥協が成立する領域', 'green');
    b.addNode('remaining',  '残存する対立',      'green');
    b.addEdge('summary', 'settled');
    b.addEdge('summary', 'compromise');
    b.addEdge('summary', 'remaining');

    sectionPoints.settled.forEach((pt, i) => {
        b.addNode(`s${i}`, pt, 'green'); b.addEdge('settled',    `s${i}`);
    });
    sectionPoints.compromise.forEach((pt, i) => {
        b.addNode(`c${i}`, pt, 'green'); b.addEdge('compromise', `c${i}`);
    });
    sectionPoints.remaining.forEach((pt, i) => {
        b.addNode(`r${i}`, pt, 'green'); b.addEdge('remaining',  `r${i}`);
    });

    return b.build();
};

// ============================================================
// Section 5: エントリポイント
// ============================================================

/**
 * 両マインドマップを並列生成して返す
 * @returns {Promise<{ mindmap1: string, mindmap2: string }>}
 */
const buildMindmapCode = async (topic, agents, result) => {
    const [mindmap1, mindmap2] = await Promise.all([
        buildMindmap1Code(topic, agents, result),
        buildMindmap2Code(agents, result),
    ]);
    return { mindmap1, mindmap2 };
};

module.exports = { buildMindmapCode };
