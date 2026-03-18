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
    return `あなたは「${agent.label}」というアイデアの代弁者AIです。この立場は議論を通じて変わらない。
以下の情報に基づき、自分の立場を${PHASE1_MAX_CHARS}文字以内で表明してください。

【主張（coreClaim）】
${agent.coreClaim}

【根拠（rationale）】
${agent.rationale}

【立場を補強する具体的事実・経験（experience）】
${experiencePart}

【前提条件（preconditions）】
${agent.preconditions}

【記述手順（この順番で記述すること）】
1. rationaleとexperienceを根拠として「事実ベースの主張」と「価値判断」に分けて提示すること
2. preconditionsに含まれる暗黙の前提を1つ選び、「この主張は〇〇を前提としている」という文形で自ら開示すること

【制約】
- 他のアイデアや相手への言及・批判・比較を一切しないこと
- 日本語で記述すること
- 回答全体を${PHASE1_MAX_CHARS}文字以内に収めること`;
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
    return `あなたは「${agent.label}」というアイデアを代弁するAIエージェントです。この立場は議論を通じて変わらない。
ウェブ検索を使って以下の情報を収集してください。

【自分の主張】
以下の主張を支持するデータや事例を1件ウェブ検索で取得し、根拠として使用すること。
${agent.coreClaim}

【他のアイデアの主張一覧】
以下の各主張を弱める反証データを各1件ウェブ検索で取得し、攻撃の根拠として使用すること。
${otherClaimsList}

【出力形式】
各情報は必ず「検索取得:」という文言を前置きし、情報源（URL・組織名・発行日等）を明示すること。
日本語で記述すること。

【制約】
回答全体を${PHASE2_3_MAX_CHARS}文字以内に収めること。`;
};

/**
 * フェーズ2ステップ3: 全対全反論プロンプト生成
 * @param {object} attackerAgent - 攻撃側エージェント情報
 * @param {object} defenderAgent - 防御側エージェント情報
 * @param {string} credibilityText - 信頼性検証結果テキスト
 * @returns {string} プロンプト文字列
 */

const buildPhase2Step3Prompt = (attackerAgent, defenderAgent, credibilityText, defenderOpening) => {
    const defenderOpeningPart = defenderOpening
        ? `\n【${defenderAgent.label}のフェーズ1表明文】\n以下の表明文を参照し、防御側が自ら開示した暗黙の前提を特定して攻撃の起点とすること。\n${defenderOpening}\n`
        : '';

    return `あなたは「${attackerAgent.label}」というアイデアを代弁するAIエージェントです。
自分の主張「${attackerAgent.coreClaim}」を一貫して守りながら、「${defenderAgent.label}」の主張「${defenderAgent.coreClaim}」に反論してください。

【自分の取得情報】
以下の情報を根拠として使用し、反論を補強すること。
${attackerAgent.researchText || 'なし'}

【${defenderAgent.label}の根拠と前提条件】
以下の根拠「${defenderAgent.rationale}」と前提条件「${defenderAgent.preconditions}」の弱点を突き、攻撃の起点とすること。
${defenderOpeningPart}
【信頼性検証結果】
以下の検証結果を参照し、相手の取得情報の信頼性が低い箇所を反論の根拠として活用すること。
${credibilityText}

【制約】
- 回答全体を${PHASE2_3_MAX_CHARS}文字以内に収めること
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
        ? '(まだ発言はありません)'
        : log.map(entry =>
            `[ターン${entry.turn} / 攻撃モード:${entry.attackMode}]\n` +
            entry.utterances.map(u => `${u.label}: ${u.text}`).join('\n')
        ).join('\n\n');

    const attackInstruction = buildAttackModeInstruction(attackMode);

    const discussedPart = discussedTopicsStr
        ? `\n【議論済み論点(繰り返し禁止)】\n以下の論点はすでに議論済みである。これらを繰り返さず、新たな角度から攻撃すること。\n${discussedTopicsStr}\n`
        : '';

    return `あなたは「${agent.label}」のAIエージェントです。
自分の主張「${agent.coreClaim}」と前提条件「${agent.preconditions}」を一貫して守りながら、サブ議題「${subTopicTitle}」の文脈で相手の論点に反論してください。

【これまでの発言ログ】
以下のログを参照し、相手の最新の主張を特定した上で反論すること。
${logText}
${discussedPart}
【攻撃戦略】
以下の攻撃モードの指示に従い、反論を構成すること。
${attackInstruction}

【制約】
- 回答全体を${PHASE2_3_MAX_CHARS}文字以内に収めること
- 議論済み論点の繰り返しは厳禁
- 末尾に「一言要約:」として、「${agent.coreClaim}」をサブ議題「${subTopicTitle}」の観点から一文で再表明すること
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
相手が提示した根拠・データ・事実に対して「その数値は何を測定しているか」「サンプルの代表性はあるか」「測定方法の妥当性はあるか」を問い、信頼性を崩すこと。
ウェブ検索を使用し、相手のデータへの反証または限界を示す外部情報を必ず1件引用すること（「検索取得:」を前置きして情報源を明示）。`;
        case 'β':
            return `【攻撃モードβ: 主張の適用条件限定化】
相手の主張が「特殊な条件・状況下でのみ成立する」ことを示すこと。「それはXという条件下でのみ成立し、一般化できない」という形で論じること。その条件を具体的に特定し、その条件が実際には限定的であることを示すこと。`;
        default:
            return '';
    }
};

/**
 * フェーズ4ターン1: 独立統合表明プロンプト生成
 * @param {object} agent - エージェント情報
 * @param {string} subTopicSummaries - 全サブ議題の結論サマリー
 * @returns {string} プロンプト文字列
 */
const buildPhase4Turn1Prompt = (agent, subTopicSummaries) => {
    return `あなたは「${agent.label}」というアイデアを代弁するAIエージェントです。
自分の主張「${agent.coreClaim}」と前提条件「${agent.preconditions}」を一貫して守りながら、以下の手順で統合表明を行ってください。

【全サブ議題の議論結論】
以下の各サブ議題の結論を根拠として、手順1〜手順3の記述に活用すること。
${subTopicSummaries}

【記述手順（この順番で記述すること）】
手順1: 維持する主張: 議論を経ても変わらず支持する自分の主張の核心を明示すること
手順2: 譲歩する点: 議論を通じて認める部分を具体的に記述すること
手順3: 残存する対立点があれば1つだけ明示すること（存在しない場合は「残存する対立点はなし」と明記すること）

【制約】
- 回答全体を${PHASE4_MAX_CHARS}文字以内に収めること
- 日本語で記述すること`;
};

/**
 * フェーズ4ターン2: 相互参照後の統合表明プロンプト生成
 * @param {object} agent - エージェント情報
 * @param {string} subTopicSummaries - 全サブ議題の結論サマリー
 * @param {string[]} otherAgentTurn1Texts - 他エージェントのターン1での統合表明テキスト配列
 * @returns {string} プロンプト文字列
 */
const buildPhase4Turn2Prompt = (agent, subTopicSummaries, otherAgentTurn1Texts) => {
    const othersStr = otherAgentTurn1Texts && otherAgentTurn1Texts.length > 0
        ? `\n【他のエージェントのターン1での統合表明】\n以下の各エージェントの統合表明を参照し、自分の立場との差異を手順2・手順3に反映すること。\n${otherAgentTurn1Texts.join('\n\n')}\n`
        : '';

    return `あなたは「${agent.label}」というアイデアを代弁するAIエージェントです。
自分の主張「${agent.coreClaim}」と前提条件「${agent.preconditions}」を一貫して守りながら、他のエージェントの統合表明を踏まえた上で、以下の手順で統合表明を行ってください。

【全サブ議題の議論結論】
以下の各サブ議題の結論を根拠として、手順1〜手順3の記述に活用すること。
${subTopicSummaries}
${othersStr}
【記述手順（この順番で記述すること）】
手順1: 維持する主張: 議論を経ても変わらず支持する自分の主張の核心を明示すること
手順2: 譲歩する点: 他の主張から学び、認める部分を具体的に記述すること
手順3: 残存する対立点があれば1つだけ明示すること（存在しない場合は「残存する対立点はなし」と明記すること）

【制約】
- 回答全体を${PHASE4_MAX_CHARS}文字以内に収めること
- 日本語で記述すること`;
};

module.exports = {
    buildPhase1Prompt,
    buildPhase2Step1Prompt,
    buildPhase2Step3Prompt,
    buildPhase3Prompt,
    buildAttackModeInstruction,
    buildPhase4Turn1Prompt,
    buildPhase4Turn2Prompt,
};
