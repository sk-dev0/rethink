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

    return `あなたは中立的な情報評価AIです。
以下の各エージェントが取得した情報の信頼性を評価してください。

${infoText}

【評価基準】
各情報を以下の4基準でそれぞれ1〜5のスコアで評価すること：
1. 情報源の権威性（学術機関・政府機関・業界団体など）
2. データの再現性（同様の結果が再現可能か）
3. バイアスの有無（利益相反・偏向の可能性）
4. 情報の新しさ（発行年・データの鮮度）

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
  }
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
 * サブ議題抽出と要素分解をAIに実行させる
 * @param {Array<string>} rebuttals
 * @returns {Promise<{subTopics: Array, decomposition: object}>}
 */
const runSubTopicExtraction = async (rebuttals) => {
    const prompt = buildSubTopicExtractionPrompt(rebuttals);
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    if (!result) return { subTopics: [], decomposition: {} };

    try {
        const cleaned = result.replace(/```json|```/g, '').trim();
        return JSON.parse(cleaned);
    } catch {
        return { subTopics: [], decomposition: {} };
    }
};

module.exports = {
    buildCredibilityCheckPrompt,
    buildSubTopicExtractionPrompt,
    checkSemanticBranch,
    extractSubSubTopics,
    runCredibilityCheck,
    runSubTopicExtraction,
};
