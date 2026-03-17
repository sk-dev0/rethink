/**
 * promptBuilders.js
 * 各フェーズで使うGeminiへのプロンプト文字列を生成する関数群
 * AI呼び出しは一切行わず、文字列を組み立てて返すだけ
 */

const { PHASE1_MAX_CHARS, PHASE2_3_MAX_CHARS, PHASE4_MAX_CHARS } = require('./constants');

/**
 * フェーズ1: 立場表明プロンプト生成
 * @param {object} agent - { label, coreClaim, rationale, preconditions, experience? }
 * @returns {string} プロンプト文字列
 */
const buildPhase1Prompt = (agent) => {
    const experiencePart = agent.experience
        ? `\n具体的な事実・経験: ${agent.experience}`
        : '';
    return `あなたは「${agent.label}」というアイデアの代弁者AIです。
以下の情報に基づき、自分の立場を${PHASE1_MAX_CHARS}文字以内で表明してください。

【主張（coreClaim）】
${agent.coreClaim}

【根拠（rationale）】
${agent.rationale}${experiencePart}

【前提条件（preconditions）】
${agent.preconditions}

【制約】
- 他のアイデアや相手への言及は一切しないこと
- 事実ベースの主張と価値判断を明確に区別して提示すること
- rationaleとexperienceを根拠として活用すること
- preconditionsに含まれる暗黙の前提を一つだけ自ら開示すること
- 日本語で記述すること`;
};

/**
 * フェーズ2ステップ1: 情報取得プロンプト生成
 * @param {object} agent - 自分のエージェント情報
 * @param {Array<{label: string, coreClaim: string}>} otherAgents - 他エージェント一覧
 * @returns {string} プロンプト文字列
 */
const buildPhase2Step1Prompt = (agent, otherAgents) => {
    const otherClaimsList = otherAgents
        .map(a => `- ${a.label}: ${a.coreClaim}`)
        .join('\n');
    return `あなたは「${agent.label}」のAIエージェントです。
ウェブ検索を使って以下の情報を収集してください。

【自分の主張】
${agent.coreClaim}

【他のアイデアの主張一覧】
${otherClaimsList}

【タスク】
1. 自分の主張（${agent.label}）を支持するデータや事例を1件ウェブ検索で取得すること
2. 他の各アイデアの主張を弱める反証データを各1件ウェブ検索で取得すること

【出力形式】
各情報は必ず「検索取得:」という文言を前置きし、情報源（URL・組織名・発行日等）を明示すること。
日本語で記述すること。`;
};

/**
 * フェーズ2ステップ3: 全対全反論プロンプト生成
 * @param {object} attackerAgent - 攻撃側エージェント情報
 * @param {object} defenderAgent - 防御側エージェント情報
 * @param {string} credibilityText - 信頼性検証結果テキスト
 * @returns {string} プロンプト文字列
 */
const buildPhase2Step3Prompt = (attackerAgent, defenderAgent, credibilityText) => {
    return `あなたは「${attackerAgent.label}」のAIエージェントです。
以下の信頼性検証結果を踏まえた上で、「${defenderAgent.label}」の主張に${PHASE2_3_MAX_CHARS}文字以内で反論してください。

【${defenderAgent.label}の主張】
${defenderAgent.coreClaim}

【信頼性検証結果】
${credibilityText}

【制約】
- 反論の目的はサブ議題の候補を生み出すことのみ。結論を出すことを禁止する
- さらに深く議論すべき論点を1〜2個、末尾に明示すること（「論点候補:」という見出しをつけること）
- 日本語で記述すること`;
};

/**
 * フェーズ3: サブ議題別議論プロンプト生成
 * @param {object} agent - エージェント情報
 * @param {string} subTopicTitle - サブ議題タイトル
 * @param {Array} log - これまでの発言ログ
 * @param {string} attackMode - 現在の攻撃モード（α/β/γ/δ）
 * @param {string} discussedTopicsStr - 議論済み論点リスト（カンマ区切り）
 * @returns {string} プロンプト文字列
 */
const buildPhase3Prompt = (agent, subTopicTitle, log, attackMode, discussedTopicsStr) => {
    const logText = log.length === 0
        ? '（まだ発言はありません）'
        : log.map(entry =>
            entry.utterances.map(u => `[ターン${entry.turn}] ${u.label}: ${u.text}`).join('\n')
        ).join('\n\n');

    const attackInstruction = buildAttackModeInstruction(attackMode);

    const discussedPart = discussedTopicsStr
        ? `\n【議論済み論点（繰り返し禁止）】\n${discussedTopicsStr}\n`
        : '';

    return `あなたは「${agent.label}」のAIエージェントです。
以下のサブ議題について${PHASE2_3_MAX_CHARS}文字以内で発言してください。

【サブ議題】
${subTopicTitle}

【これまでの発言ログ】
${logText}
${discussedPart}
【攻撃戦略】
${attackInstruction}

【制約】
- 議論済み論点の繰り返しは厳禁
- 末尾に「一言要約:」として、coreClaim（${agent.coreClaim}）をこのサブ議題の観点から一文で再表明すること
- 日本語で記述すること`;
};

/**
 * 攻撃モードの指示文生成
 * @param {string} mode - α/β/γ/δ
 * @returns {string} 攻撃戦略の指示文
 */
const buildAttackModeInstruction = (mode) => {
    switch (mode) {
        case 'α':
            return `【攻撃モードα: 根拠データの信頼性攻撃】
相手のデータの測定方法・サンプルの代表性・調査の再現性を具体的に問い、それを覆す反証データをウェブ検索で1件引用すること（「検索取得:」を前置きして情報源を明示）。`;
        case 'β':
            return `【攻撃モードβ: 主張の適用条件限定化】
相手の主張が成立する条件が非常に限定的であることを示すこと。特殊な前提や例外的な状況下でのみ成立することを具体的な反例を挙げて論証すること。`;
        default:
            return `【攻撃モード: 論理的反論】
相手の主張の論理的矛盾や根拠の弱点を具体的に指摘すること。`;
    }
};

/**
 * フェーズ4ステップ1: 統合表明プロンプト生成
 * @param {object} agent - エージェント情報
 * @param {string} subTopicSummaries - 全サブ議題の結論サマリー
 * @param {string[]} otherAgentTurn1Texts - 他エージェントのターン1での統合表明テキスト配列
 * @returns {string} プロンプト文字列
 */
const buildPhase4Step1Prompt = (agent, subTopicSummaries, otherAgentTurn1Texts) => {
    const othersPart = otherAgentTurn1Texts && otherAgentTurn1Texts.length > 0
        ? `\n【他のエージェントの統合表明（ターン1）】\n${otherAgentTurn1Texts.join('\n\n')}\n`
        : '';

    return `あなたは「${agent.label}」のAIエージェントです。
これまでの全議論を踏まえ、${PHASE4_MAX_CHARS}文字以内で統合表明を行ってください。

【自分の主張】
${agent.coreClaim}

【全サブ議題の結論サマリー】
${subTopicSummaries}
${othersPart}
【記述手順（この順番で記述すること）】
1. 維持する主張: 議論を経ても変わらず支持する自分の主張の核心
2. 譲歩する点: 他の主張から学び、認める部分
3. 残存する対立点: まだ解決されていない根本的な対立

日本語で記述すること。`;
};

module.exports = {
    buildPhase1Prompt,
    buildPhase2Step1Prompt,
    buildPhase2Step3Prompt,
    buildPhase3Prompt,
    buildAttackModeInstruction,
    buildPhase4Step1Prompt,
};
