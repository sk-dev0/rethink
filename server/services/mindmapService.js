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
    MINDMAP_REBUTTAL_MAX_CHARS,
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
    rebuttal:    MINDMAP_REBUTTAL_MAX_CHARS,
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
 * 最終総括テキストを4セクションに分割（3段階フォールバック付き）
 * @returns {{ settled: string, compromise: string, remaining: string, actions: string }}
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
    let actions    = extractContent(parts[4]);

    if (!settled)
        settled    = text.match(/解決済み争点[^\n]*\n([\s\S]*?)(?=妥協|残存|人間が|推奨|$)/)?.[1]?.trim().slice(0, 500) || '';
    if (!compromise)
        compromise = text.match(/妥協[^\n]*\n([\s\S]*?)(?=残存|人間が|推奨|$)/)?.[1]?.trim().slice(0, 500) || '';
    if (!remaining)
        remaining  = text.match(/残存[^\n]*\n([\s\S]*?)(?=推奨|人間が最終|$)/)?.[1]?.trim().slice(0, 500) || '';
    if (!remaining)
        remaining  = text.match(/人間が[^\n]*\n([\s\S]*?)(?=推奨|$)/)?.[1]?.trim().slice(0, 500) || '';
    if (!actions)
        actions    = text.match(/推奨アクション[^\n]*\n([\s\S]*?)$/)?.[1]?.trim().slice(0, 500) || '';

    if (!settled && !compromise && !remaining && text.trim()) {
        const chunk = Math.ceil(text.length / 4);
        settled    = text.slice(0, chunk).trim();
        compromise = text.slice(chunk, chunk * 2).trim();
        remaining  = text.slice(chunk * 2, chunk * 3).trim();
        actions    = text.slice(chunk * 3).trim();
    }
    return { settled, compromise, remaining, actions };
};

/**
 * 推奨アクションセクションから具体的なアクション項目を Gemini で抽出
 * @param {string} actionsText
 * @returns {Promise<string[]>}
 */
const extractActionPoints = async (actionsText) => {
    if (!actionsText) return [];
    const limit = getCharLimit('label');

    const prompt =
`以下の「推奨アクション」セクションを読み，各アクション項目を${limit}字以内の名詞句で抽出せよ。
「誰が何をするか」が一目でわかる具体的な表現にすること。説明文・導入文は不可。
必ずJSON配列形式のみで返すこと。コードブロック不要。最大5件まで。

${actionsText.slice(0, 600)}

出力例: ["PMがユーザーテスト実施","エンジニアがプロト開発","UXチームが調査設計"]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed)) return parsed.slice(0, 5);

    // フォールバック: 文単位で分割
    return (actionsText || '').split(/[。\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 4 && s.length <= limit)
        .slice(0, 5);
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
        const allUtterances = (r.discussionLog || []).flatMap(turn => turn.utterances || []);
        const text = allUtterances.map(u => `${u.label}: ${u.text.slice(0, 150)}`).join('\n');
        return `[${i}] サブ議題:${r.subTopic.title}\n${text || '（発言なし）'}`;
    });

    const prompt =
`以下のサブ議題ごとの全議論を読み，各サブ議題で「何が明らかになったか・どのような結論や収束点が浮かび上がったか」を${limit}字以内の日本語で要約せよ。
対立の羅列ではなく，議論の到達点・重要な発見・方向性の絞り込みを優先すること。説明文・導入文は不可。
必ずJSON配列形式のみを出力せよ。コードブロック不要。入力と同じ順序・個数で返すこと。

${discussions.map(d => d.slice(0, 800)).join('\n\n')}

出力例（2件）: ["段階リリースで双方が合意", "コスト優先の方針が浮上"]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed) && parsed.length === phase3.length) return parsed;

    return phase3.map(r => (r.subTopic.title || '').slice(0, limit - 1) + '…');
};

/**
 * 各サブ議題に関連する反論インデックス群を Gemini でマッチング
 * 複数の反論が関連する場合はすべて返す。対応なしは空配列（= n0 直結）
 * @returns {Promise<number[][]>} phase3 と同順の rebuttal インデックス配列の配列
 */
const matchRebuttalToSubtopics = async (rebuttals, phase3) => {
    if (rebuttals.length === 0 || phase3.length === 0)
        return phase3.map(() => []);

    const rebList = rebuttals.map((r, i) =>
        `[${i}] ${r.attacker}→${r.defender}: ${r.text.slice(0, 100)}`
    ).join('\n');
    const subList = phase3.map((r, i) =>
        `[${i}] ${r.subTopic.title}`
    ).join('\n');

    const prompt =
`以下の反論リストとサブ議題リストを照合し，各サブ議題に関連する反論のインデックスをすべて答えよ。
複数の反論が関連する場合はすべて含めること。対応する反論がない場合は空配列 [] を返すこと。
必ずJSON形式（配列の配列）のみを出力せよ。コードブロック不要。サブ議題と同じ順序・個数で返すこと。

【反論リスト】
${rebList}

【サブ議題リスト】
${subList}

出力例（サブ議題3件）: [[0, 1], [2], []]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed) && parsed.length === phase3.length) {
        return parsed.map(arr => {
            if (!Array.isArray(arr)) return [];
            return arr.filter(idx =>
                typeof idx === 'number' && idx >= 0 && idx < rebuttals.length
            );
        });
    }
    // フォールバック: modulo接続（各サブ議題に1件ずつ）
    return phase3.map((_, i) => [i % rebuttals.length]);
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
        return `[${i}] ${agent.label}\n=== 統合表明1 ===\n${t1}\n=== 統合表明2 ===\n${t2}`;
    });

    const prompt =
`以下のエージェントごとの統合表明1・2を読み，各エージェントについて下記6項目を${limit}字以内の日本語で抽出せよ。

【抽出ルール】
- 各テキストには「手順1 維持する主張:」「手順2 譲歩する点:」「手順3 残存する対立点:」の見出しが必ず含まれる。その見出し直後の内容を参照すること。
- maintain:    統合表明1の「手順1 維持する主張:」の核心を${limit}字以内で
- concede:     統合表明1の「手順2 譲歩する点:」の内容を${limit}字以内で
- conflict:    統合表明1の「手順3 残存する対立点:」の内容を${limit}字以内で。「残存する対立点はなし」と書かれていれば「対立点なし」と返すこと
- t2_maintain: 統合表明2の「手順1 維持する主張:」を${limit}字以内で。ターン1から変化していれば変化点を優先すること
- t2_concede:  統合表明2の「手順2 譲歩する点:」を${limit}字以内で。ターン1と異なる部分を優先すること
- t2_conflict: 統合表明2の「手順3 残存する対立点:」を${limit}字以内で。ターン2では必ず何らかの対立点または解消状況が記載されているはずなので，それを具体的に抽出すること。「残存する対立点はなし」なら「対立解消」と返すこと

【共通制約】
- 「記述なし」「情報不足」「不明」等の無内容な語は絶対に使わないこと
- 説明文・導入文は不可。パッと見てわかる具体的な内容にすること
- 必ずJSON配列形式のみを出力。コードブロック不要。入力と同じ順序・個数で返すこと

${items.join('\n\n')}

出力例（2エージェント）:
[{"maintain":"UI簡素化を堅持","concede":"機能数を削減","conflict":"コスト負担の配分","t2_maintain":"UI原則は維持確認","t2_concede":"削減幅を縮小提案","t2_conflict":"配分比率は引き続き交渉"},{"maintain":"機能充実を主張","concede":"段階的リリース受入","conflict":"品質基準の定義","t2_maintain":"充実方針を再確認","t2_concede":"段階案を精緻化","t2_conflict":"品質指標の定義は合意に向け進展"}]`;

    const raw = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }]);
    const parsed = parseJsonResponse(raw);
    if (Array.isArray(parsed) && parsed.length === agents.length) return parsed;

    // フォールバック: 空文字列を返す（プレフィックスのみ表示になり「内容不明」より視覚的にマシ）
    return agents.map(() => ({
        maintain:    '',
        concede:     '',
        conflict:    '',
        t2_maintain: '',
        t2_concede:  '',
        t2_conflict: '',
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
    red:    'fill:#fff,stroke:#dc3545,stroke-width:1.5px,color:#212529',
    blue:   'fill:#fff,stroke:#0d6efd,stroke-width:1.5px,color:#212529',
    green:  'fill:#fff,stroke:#198754,stroke-width:1.5px,color:#212529',
    orange: 'fill:#fff,stroke:#fd7e14,stroke-width:1.5px,color:#212529',
    conn:   'fill:#f8f9fa,stroke:#6c757d,stroke-width:1.5px,stroke-dasharray:4 2,color:#6c757d',
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
    const phase3        = result.phase3 || [];
    const rebuttals     = result.phase2?.rebuttals || [];
    const assumptionLog = result.assumptionDebateLog || [];

    /** γ討議発言を summarizeLabels 用のテキストに変換 */
    const toGammaSummaryInput = (assump) => {
        const utterances = assump.gammaUtterances || [];
        return utterances.map(u => `${u.label || ''}: ${u.text || ''}`).join('\n').slice(0, 300);
    };

    // 並列データ取得（各グループが独立した配列のため index ずれなし）
    const [
        conSummaries,
        rebuttalMatches,
        topicSums,
        claimSums,
        reasonSums,
        rebuttalSums,
        gammaSummaries,
        assumptionContentSums,
    ] = await Promise.all([
        extractSubtopicSummaries(phase3),
        matchRebuttalToSubtopics(rebuttals, phase3),
        summarizeLabels([topic],                          getCharLimit('label')),
        summarizeLabels(agents.map(a => a.coreClaim),     getCharLimit('label')),
        summarizeLabels(agents.map(a => a.rationale),     getCharLimit('label')),
        rebuttals.length > 0
            ? summarizeLabels(rebuttals.map(r => r.text), getCharLimit('rebuttal'))
            : Promise.resolve([]),
        assumptionLog.length > 0
            ? summarizeLabels(assumptionLog.map(toGammaSummaryInput), getCharLimit('label'))
            : Promise.resolve([]),
        assumptionLog.length > 0
            ? summarizeLabels(assumptionLog.map(a => a.content || ''), getCharLimit('label'))
            : Promise.resolve([]),
    ]);

    const b = createGraphBuilder();
    applyClassDefs(b, 'red', 'blue', 'conn', 'orange'); // orange: 暗黙の前提・γ討議（未使用でも無害）

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
    // エージェントラベルの共通プレフィックスを除いて短縮表示（例: "アイデアA"→"A"）
    const agentLabels = agents.map(a => a.label);
    const commonPfx = (() => {
        if (agentLabels.length < 2) return '';
        let pfx = agentLabels[0];
        for (const l of agentLabels.slice(1)) {
            while (pfx && !l.startsWith(pfx)) pfx = pfx.slice(0, -1);
        }
        return pfx;
    })();
    const shortLabel = (label) => (label && commonPfx && label.startsWith(commonPfx))
        ? label.slice(commonPfx.length)
        : label;

    rebuttals.forEach((r, i) => {
        const defenderIdx = agents.findIndex(a => a.label === r.defender);
        const fromId = defenderIdx >= 0 ? `reason_${defenderIdx}` : 'n0';
        b.addNode(`reb${i}`, `${shortLabel(r.attacker)}→${shortLabel(r.defender)}: ${rebuttalSums[i] || ''}`, 'red');
        b.addEdge(fromId, `reb${i}`);
    });

    // ── サブ議題・サブサブ議題（青）──
    // rebuttalMatches[i] === -1 のサブ議題は n0 に直結
    const nodeIdMap = {};
    const depth0 = phase3.filter(r => r.subTopic.depth === 0);
    const depthN = phase3
        .filter(r => r.subTopic.depth > 0)
        .sort((a, b) => a.subTopic.depth - b.subTopic.depth);

    depth0.forEach((r, localIdx) => {
        const nid       = `sub${localIdx}`;
        // filter() は同一オブジェクト参照を保持するため indexOf が正しく機能する
        // （phase3 が再構築された場合は findIndex に切り替えること）
        const phase3Idx = phase3.indexOf(r);
        const rebIdxArr = rebuttalMatches[phase3Idx >= 0 ? phase3Idx : localIdx] || [];
        nodeIdMap[r.subTopic.id] = nid;
        b.addNode(nid, `サブ議題: ${r.subTopic.title}`, 'blue');
        if (rebIdxArr.length > 0) {
            rebIdxArr.forEach(rebIdx => b.addEdge(`reb${rebIdx}`, nid));
        } else {
            b.addEdge('n0', nid);
        }
    });

    depthN.forEach((r, i) => {
        const nid = `ss${i}`;
        nodeIdMap[r.subTopic.id] = nid;
        b.addNode(nid, `サブ議題: ${r.subTopic.title}`, 'blue');
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

    // ── 暗黙の前提・γ討議（オレンジ）: 始発ノード ──
    // dependsOn の先頭エージェント名を "〇の前提:" として表示
    const gammaLeafIds = [];
    assumptionLog.forEach((assump, i) => {
        const depLabels  = assump.dependsOn || [];
        const shortDeps  = depLabels.map(l => shortLabel(l)).join('・');
        const prefix     = shortDeps ? `${shortDeps}の前提: ` : '前提: ';
        const assumpId  = `assump_${i}`;
        b.addNode(assumpId, `${prefix}${assumptionContentSums[i] || assump.content || `前提${i}`}`, 'orange');
        // 始発ノードのため親への接続なし
        if (gammaSummaries[i]) {
            const gammaId = `agamma_${i}`;
            b.addNode(gammaId, `γ討議: ${gammaSummaries[i]}`, 'orange');
            b.addEdge(assumpId, gammaId);
            gammaLeafIds.push(gammaId);
        } else {
            gammaLeafIds.push(assumpId);
        }
    });

    // ── 継続コネクタ（右端）──
    const allLeafIds = [...leafIds, ...gammaLeafIds];
    b.addNode('cont1', '→ 統合フェーズへ', 'conn');
    (allLeafIds.length > 0 ? allLeafIds : ['n0']).forEach(lid => b.addEdge(lid, 'cont1'));

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
    const { settled, compromise, remaining, actions } = parseFinalSummary(phase4.finalSummary || '');

    const [sectionPoints, integrationStructure, actionPoints] = await Promise.all([
        extractSectionPoints(settled, compromise, remaining),
        extractIntegrationStructure(agents, turn1Data, turn2Data),
        extractActionPoints(actions),
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

        b.addNode(stmtId,  `${agent.label}の統合表明`, 'blue');
        b.addNode(maintId, `解決済み: ${s.maintain || `${agent.label}が維持`}`,       'blue');
        b.addNode(concId,  `妥協領域: ${s.concede  || `${agent.label}が譲歩`}`,       'blue');
        b.addNode(conflId, `残存論点: ${s.conflict || `${agent.label}の残存対立点`}`,  'blue');
        b.addNode(t2MId,   `解決済み: ${s.t2_maintain || ''}`, 'blue');
        b.addNode(t2CnId,  `妥協領域: ${s.t2_concede  || ''}`, 'blue');
        b.addNode(t2CfId,  `残存論点: ${s.t2_conflict || ''}`, 'blue');

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

    if (sectionPoints.settled.length > 0) {
        sectionPoints.settled.forEach((pt, i) => {
            b.addNode(`s${i}`, pt, 'green'); b.addEdge('settled', `s${i}`);
        });
    } else {
        b.addNode('s_none', '解決済み争点なし', 'green');
        b.addEdge('settled', 's_none');
    }
    if (sectionPoints.compromise.length > 0) {
        sectionPoints.compromise.forEach((pt, i) => {
            b.addNode(`c${i}`, pt, 'green'); b.addEdge('compromise', `c${i}`);
        });
    } else {
        b.addNode('c_none', '妥協案なし', 'green');
        b.addEdge('compromise', 'c_none');
    }

    if (sectionPoints.remaining.length > 0) {
        sectionPoints.remaining.forEach((pt, i) => {
            b.addNode(`r${i}`, pt, 'green'); b.addEdge('remaining', `r${i}`);
        });
    } else {
        b.addNode('r_none', '残存論点なし', 'green');
        b.addEdge('remaining', 'r_none');
    }

    // ── 推奨アクション（緑）──
    if (actionPoints.length > 0) {
        b.addNode('actions', '推奨アクション', 'green');
        b.addEdge('summary', 'actions');
        actionPoints.forEach((pt, i) => {
            b.addNode(`act${i}`, pt, 'green');
            b.addEdge('actions', `act${i}`);
        });
    }

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
    try {
        const [mindmap1, mindmap2] = await Promise.all([
            buildMindmap1Code(topic, agents, result),
            buildMindmap2Code(agents, result),
        ]);
        return { mindmap1, mindmap2 };
    } catch (err) {
        console.error('[mindmapService] buildMindmapCode failed:', err);
        return { mindmap1: '', mindmap2: '' };
    }
};

module.exports = { buildMindmapCode };
