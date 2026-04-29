/**
 * moderatorService.js
 * 中立的なモデレーター役のAI呼び出しとそのプロンプト生成を担う
 */

const { callGeminiWithRetry } = require('./geminiClient');
const { SEMANTIC_BRANCH_THRESHOLD } = require('./constants');

/**
 * フェーズ2ステップ2: 情報信頼性検証プロンプト生成
 * @param {Array<{label: string, text: string}>} agentInfos - 各エージェントの取得情報
 * @returns {string} プロンプト文字列
 */
const buildCredibilityCheckPrompt = (agentInfos) => {
    const infoText = agentInfos
        .map(a => `【${a.label}の取得情報】\n${a.text}`)
        .join('\n\n');
    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
    const recentThreshold = new Date().getFullYear() - 3;

    return `あなたは中立的な情報評価AIです。
以下の各エージェントが取得した情報の信頼性を評価してください。

${infoText}

【評価基準】
各情報を以下の4基準でそれぞれ1〜5のスコアで評価すること：
1. 情報源の権威性
- 5: 政府機関・国際機関・査読済み学術論文
- 3: 業界団体・主要ニュースメディア・企業の公式レポート
- 1: 個人ブログ・出典不明・匿名情報

2. データの再現性
- 5: サンプルサイズ・測定方法・調査期間が明示されており、同条件で再現可能
- 3: 調査概要は記載されているが一部情報が欠落している
- 1: サンプルサイズ・測定方法の記載がなく再現不可能

3. バイアスの有無
- 5: 利益相反なし・複数の立場からの検証あり
- 3: 情報源に利害関係があるが、データ自体は客観的
- 1: 情報源が主張の発信者と同一・明確な利益相反あり

4. 情報の新しさ（本日${today}を基準とする）
- 5: ${new Date().getFullYear() - 1}年以降の情報
- 3: ${recentThreshold}年〜${new Date().getFullYear() - 1}年の情報
- 1: ${recentThreshold}年以前の情報、または発行年不明


各エージェントについてスコアと評価コメントを記述し、日本語で出力すること。`;
};

/**
 * フェーズ2ステップ4: サブ議題抽出と要素分解のプロンプト生成
 * @param {Array<string>} rebuttals - 全対全の反論テキスト群
 * @returns {string} プロンプト文字列
 */
const buildSubTopicExtractionPrompt = (rebuttals) => {
    const rebuttalText = rebuttals.join('\n\n---\n\n');

    return `あなたは中立的な議論分析AIです。
以下の反論テキスト群を分析して、サブ議題の抽出と各アイデアの要素分解を行ってください。

【反論テキスト群】
${rebuttalText}

【タスク】
1. サブ議題を最大5件抽出すること。意味的類似度が高いものは統合して重複を排除すること
2. 各アイデアの主張の要素分解（主な論点・根拠・価値前提）を行うこと
3. 各エージェントの主張が暗黙的に依存している前提を最大3件抽出すること。各前提は識別子（A1、A2のような連番）、前提の内容（20文字以上50文字以内の平叙文）、この前提に依存しているエージェントのラベル名の配列の3要素で構成すること

【出力形式】
以下のJSON形式のみで返すこと（マークダウンコードブロックは不要）：
{
  "subTopics": [
    {
      "title": "サブ議題のタイトル（20文字以内）",
      "reason": "このサブ議題を選定した理由（50文字以内）"
    }
  ],
  "decomposition": {
    "アイデアラベル名": {
      "mainPoints": ["主な論点1", "論点2"],
      "evidence": ["根拠1", "根拠2"],
      "valuePremises": ["価値前提1"]
    }
  },
  "assumptions": [
    {
      "id": "A1",
      "content": "前提の内容（20文字以上50文字以内の平叙文）",
      "dependsOn": ["エージェントラベル名"]
    }
  ]
}`;
};

/**
 * セマンティック分岐スコアを判定する
 * @param {Array<string>} prevUtterances - 直前のターンの発言群
 * @param {Array<string>} currentUtterances - 現在のターンの発言群
 * @returns {Promise<number>} 論点の乖離度（0.0〜1.0）
 */
const checkSemanticBranch = async (prevUtterances, currentUtterances) => {
    const prevText = prevUtterances.join('\n');
    const currentText = currentUtterances.join('\n');

    const prompt = `あなたは議論分析AIです。
以下の2つのターンの発言群を比較し、論点の乖離度を判定してください。

【前のターンの発言】
${prevText}

【現在のターンの発言】
${currentText}

【タスク】
論点の乖離度を0.0〜1.0の数値で返してください。
- 0.0: 同じ論点について議論している
- 1.0: 全く異なる論点に発展している
- 0.7以上: 新たなサブサブ議題を設けるべきレベルの分岐

数値のみを返すこと（例: 0.75）`;

    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    if (!result) return 0.0;

    const match = result.trim().match(/\d+\.\d+|\d+/);
    if (!match) return 0.0;
    const score = parseFloat(match[0]);
    return Math.min(1.0, Math.max(0.0, score));
};

/**
 * 分岐した場合のサブサブ議題を抽出する
 * @param {Array<string>} currentUtterances - 現在のターンの発言群
 * @param {string} parentTitle - 親サブ議題のタイトル
 * @returns {Promise<Array<{title: string, reason: string}>>} サブサブ議題の配列（最大2件）
 */
const extractSubSubTopics = async (currentUtterances, parentTitle) => {
    const utterancesText = currentUtterances.join('\n');

    const prompt = `あなたは議論分析AIです。
以下の発言群から、親サブ議題「${parentTitle}」から分岐した新たなサブサブ議題を抽出してください。

【発言群】
${utterancesText}

【タスク】
サブサブ議題を最大2件抽出してください。

【出力形式】
以下のJSON形式のみで返すこと（マークダウンコードブロックは不要）：
[
  {
    "title": "サブサブ議題のタイトル（20文字以内）",
    "reason": "選定理由（50文字以内）"
  }
]`;

    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    if (!result) return [];

    try {
        const cleaned = result.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed.slice(0, 2) : [];
    } catch {
        return [];
    }
};

/**
 * 信頼性検証をAIに実行させる
 * @param {Array<{label: string, text: string}>} agentInfos
 * @returns {Promise<string>} 検証結果テキスト
 */
const runCredibilityCheck = async (agentInfos) => {
    const prompt = buildCredibilityCheckPrompt(agentInfos);
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    return result || '（信頼性検証を実行できませんでした）';
};

/**
 * 構造化された信頼性チェックを実行する
 * @param {Array<{label: string, text: string}>} agentInfos
 * @returns {Promise<{text: string, scores: object}>} 評価文テキストと構造化スコアオブジェクト
 */
const runCredibilityCheckStructured = async (agentInfos) => {
    const basePrompt = buildCredibilityCheckPrompt(agentInfos);
    const additionalInstruction = `

上記の評価に加え、各エージェントの4基準スコアを以下のJSON形式のみで返すこと。マークダウンコードブロックは不要。形式は、エージェントラベル名をキーとし、権威性・再現性・バイアス・新しさのそれぞれのスコア（1〜5の数値）と、4つの平均値を値として持つオブジェクトとする。

例: {"エージェントラベル名": {"権威性": 3, "再現性": 4, "バイアス": 2, "新しさ": 5, "平均": 3.5}}`;

    const prompt = basePrompt + additionalInstruction;
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    const text = result || '（信頼性検証を実行できませんでした）';

    let scores = {};
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            scores = JSON.parse(match[0]);
        } else {
            agentInfos.forEach(a => {
                scores[a.label] = { 権威性: 0, 再現性: 0, バイアス: 0, 新しさ: 0, 平均: 0.0 };
            });
        }
    } catch {
        agentInfos.forEach(a => {
            scores[a.label] = { 権威性: 0, 再現性: 0, バイアス: 0, 新しさ: 0, 平均: 0.0 };
        });
    }

    return { text, scores };
};

/**
 * 前提の検証可能性をスコアリングする
 * @param {string} assumptionText - 前提テキスト
 * @returns {Promise<number>} 検証可能性スコア（0.0〜1.0）
 */
const checkAssumptionVerifiability = async (assumptionText) => {
    const prompt = `あなたは中立的な議論分析AIです。以下の前提が、統計データ・調査結果・事例報告などの実証データによって支持または反証できるかを判定し、検証可能性を0.0から1.0の数値のみで返してください。1.0は実証データで完全に決着がつく前提、0.5は部分的にデータで検証できるが主観的解釈を含む前提、0.0は完全に価値観や主観的選好に依存し、データで決着がつかない前提を示します。数値のみを返すこと

${assumptionText}`;

    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    if (!result) return 0.0;

    const match = result.trim().match(/\d+\.\d+|\d+/);
    if (!match) return 0.0;
    const score = parseFloat(match[0]);
    return Math.min(1.0, Math.max(0.0, score));
};

/**
 * 前提の反証成立度をスコアリングする
 * @param {string} assumptionText - 前提テキスト
 * @param {string} gammaAttackText - γ攻撃の全発言テキスト（改行区切り結合）
 * @param {string} credibilityText - 信頼性チェック結果テキスト
 * @returns {Promise<number>} 反証成立度スコア（0.0〜1.0）
 */
const checkAssumptionInvalidation = async (assumptionText, gammaAttackText, credibilityText) => {
    const prompt = `あなたは中立的な議論分析AIです。以下の情報を参照し、γ攻撃が引用した反証データによって前提が覆されているかを判定し、反証成立度を0.0から1.0の数値のみで返してください。1.0は前提がほぼ成立しないと判断できる状態、0.7は前提の成立範囲が大幅に限定される状態、0.4は反証に一定の妥当性はあるが前提を覆すには不十分な状態、0.0は攻撃が的外れまたは反証データの信頼性が低く前提に影響しない状態を示します。数値のみを返すこと

【前提テキスト】
${assumptionText}

【γ攻撃テキスト】
${gammaAttackText}

【信頼性チェック結果】
${credibilityText}`;

    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    if (!result) return 0.0;

    const match = result.trim().match(/\d+\.\d+|\d+/);
    if (!match) return 0.0;
    const score = parseFloat(match[0]);
    return Math.min(1.0, Math.max(0.0, score));
};

/**
 * サブ議題抽出と要素分解をAIに実行させる
 * @param {Array<string>} rebuttals
 * @returns {Promise<{subTopics: Array, decomposition: object, assumptions: Array}>}
 */
const runSubTopicExtraction = async (rebuttals) => {
    const prompt = buildSubTopicExtractionPrompt(rebuttals);
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    if (!result) return { subTopics: [], decomposition: {}, assumptions: [] };

    try {
        const cleaned = result.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (!parsed.assumptions) parsed.assumptions = [];
        return parsed;
    } catch {
        return { subTopics: [], decomposition: {}, assumptions: [] };
    }
};

module.exports = {
    buildCredibilityCheckPrompt,
    buildSubTopicExtractionPrompt,
    checkSemanticBranch,
    extractSubSubTopics,
    runCredibilityCheck,
    runCredibilityCheckStructured,
    checkAssumptionVerifiability,
    checkAssumptionInvalidation,
    runSubTopicExtraction,
};
