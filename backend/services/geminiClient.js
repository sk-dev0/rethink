require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID,
    location: process.env.GOOGLE_CLOUD_LOCATION || process.env.LOCATION,
});

// socketIdをキーにしてchatオブジェクトを保存するオブジェクト
// chatオブジェクトはgeminiとの会話セッションを管理する
const chatSessions = {};

// socketIdをキーにchatオブジェクトを作成してchatSessionsに保存する関数
const createSession = async (socketId, theme) => {
    const chat = await startChat(theme);
    chatSessions[socketId] = chat;
};

// socketIdをキーにchatSessionsからchatオブジェクトを取り出す関数
const getSession = (socketId) => {
    return chatSessions[socketId];
};

// socketIdをキーにchatSessionsからchatオブジェクトを削除する関数
const deleteSession = (socketId) => {
    delete chatSessions[socketId];
};


// インタビュアーAIに与えるシステムインストラクション
// システムインストラクションはカスタム指示みたいに常に与えておくプロンプトみたいなものらしい
const systemInstruction = (theme) => `
    あなたは議論ファシリテーターのAIインタビュアーです。
    以下のルールを厳守してください。

    【テーマ】
    ${theme}

    【目的】
    参加者がこのテーマについてどのような考えを持っているかを引き出すこと。

    【引き出す項目】
    1. このテーマに対する主張（賛成・反対・条件付きなど、立場を明確にする）
    2. その主張の根拠（なぜそう思うのか、理由や考え方）
    3. 主張の前提条件（どういう条件下でその主張が成り立つか）
    4. 立場を支える具体的な経験や事実（実際に経験したこと、見聞きしたこと）

    【会話ルール】
    - 最初に議題と前提条件を参加者に読み上げてから会話を始めてください
    - 必ず日本語で話してください
    - 質問は一度に一つだけにしてください
    - 深掘りは1項目につき1回までにしてください
    - 最初に簡単な趣旨説明をしてから会話を始めてください
    - 引き出す項目をユーザーに直接説明しないでください
    - 抽象的な回答には「具体的にはどんな場面でそう感じましたか？」のように具体例を引き出してください
    - 自然な会話の流れで情報を引き出してください
    - 全項目が揃ったと判断したら、終了前に必ず「最後に、あなたの考えを一言でまとめるとどうなりますか？」と聞いてください
    - 全項目が揃ったと判断したら、必ず「インタビューを終了」という文言を返答に含めて締めくくってください
    - 質問は常に「${theme}」というテーマに沿った内容にしてください。テーマから逸れた質問は禁止します

    【注意】
    - 参加者の意見に対して「〇〇という見方もありますが、それについてはどう思いますか？」という形で軽く別視点を提示することは構いません
    - ただし否定や批判はしないでください
    - 参加者の発言を否定しないでください
    - 議題と前提条件を最初に参加者に伝える際は、以下のフォーマットで出力してください：
        「議題：〇〇
        前提条件：
        ・〇〇
        ・〇〇」
    - マークダウン記法（**や*）は使わないでください

    【重要】
    - 最初に議題と前提条件を参加者に読み上げてから会話を始めてください
    - インタビューを終了する際には必ず「インタビューを終了」というフレーズを一文字も違わずに返答に含めてください
    - インタビューを終了する際には必ず「インタビューを終了」というフレーズを一文字も違わずに返答に含めてください
`;

// chat.createは非同期関数ではないのでasync不要
// systemInstructionとthemeをもとにchatオブジェクトを作成して返す関数
const startChat =  (theme) => {
    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: systemInstruction(theme),
        },
    });
    return chat;
};

// socketIdをキーにchatSessionsからchatオブジェクトを取り出す
// GeminiのAPIにメッセージを送り、返答のテキストを返す
const sendMessage = async (socketId, message) => {
    //getSessionがsocketIdを見つけられなかった際のエラーハンドリングを追加
    const chat = getSession(socketId);
    if (!chat) {
        throw new Error(`ソケットIDが見つかりませんでした。socketId: ${socketId}`);
    }
    const result = await chat.sendMessage({ message });
    return result.text;
}

// プロファイル生成の際に与えるシステムインストラクション
const generateProfileSystemInstruction = `
    あなたは会話分析AIです。
    与えられた会話履歴を分析してJSON形式のプロファイルを生成してください。
    JSONのみを返してください。余計な文字や\`\`\`は不要です。
    情報が不足している場合は、会話全体の文脈から推定して補完してください。絶対に空文字やnullを返さないでください。
`;

// プロファイル生成の際に与えるプロンプト
const generateProfilePrompt = (socketId, historyText) => `
    以下の会話履歴を分析して、このユーザーのプロファイルを以下のJSON形式で返してください。

    {
        "socketId": "${socketId}",
        "core_claim": "ユーザーの主張を一文で明確に表現すること。このテーマに対してどういう立場・方向性を持っているかが分かるように書くこと",
        "rationale": "その主張の根拠を具体的に書くこと。抽象的な表現は避け、会話から読み取れる理由を書くこと",
        "preconditions": "主張が成立する前提条件を書くこと。会話から読み取れない場合は文脈から推定すること",
        "experience": "立場を支える具体的な事実・経験を書くこと。会話から読み取れない場合は主張から推定して書くこと"
    }

    【注意】
    - 各フィールドは必ず埋めること。情報が不足している場合は会話の文脈から推定して補完すること
    - core_claimは曖昧にせず、このテーマに対してどういう立場・方向性を持っているかが分かるように書くこと
    - 日本語で出力すること

    会話履歴：
    ${historyText}
`;

// プロファイル生成を行う関数
const generateProfile = async (socketId, history) => {
    // 今までの会話履歴をループで取り出す
    const historyText = history.map(h => `${h.role}: ${h.text}`).join('\n');

    // プロンプトをもとにプロファイルを生成
    const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: generateProfileSystemInstruction
        },
        contents: [{
            role: 'user',
            parts: [{ text: generateProfilePrompt(socketId, historyText) }]
        }]
    });

    // geminiがJSON以外のいらない情報を返すことがあるためクリーンする
    const text = result.text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Gemini APIを呼び出す（3回までリトライ）
// aiインスタンスはファイル上部で生成済みのものを使う
const callGeminiWithRetry = async (contents, maxRetries = 3, enableSearch = false) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const options = {
                model: 'gemini-2.5-flash',
                contents,
            };
            if (enableSearch) {
                options.config = {
                    tools : [{ googleSearch: {} }],
                };
            }
            const response = await ai.models.generateContent(options);
            return response.text;
        } catch (error) {
            console.error(`API呼び出し失敗 (試行 ${attempt}/${maxRetries}):`, error.message);
            if (attempt < maxRetries) await delay(2000);
        }
    }
    return null;
};

/**
 * 攻撃モードαとγで生成した発言に検索引用が含まれているか確認し、
 * 含まれていない場合は検索引用を要求して再呼び出しをかける
 * @param {string} text - 生成されたテキスト
 * @param {Array} contents - 元のプロンプトcontents
 * @returns {Promise<string|null>} 最終的なテキスト
 */
const callGeminiWithRetryForSearchQuote = async (text, contents) => {
    const hasSearchCitation = text && text.includes('検索取得:');

    if (hasSearchCitation) return text;

    // 検索引用がない場合は再呼び出し
    await delay(1000);
    const additionalInstruction = '\n\n重要: 必ず「検索取得:」という文言を前置きして、実際のウェブ検索結果を1件以上引用してください。情報源のURLまたは組織名と発行日を明示すること。';
    const retryContents = contents.map((c, i) => {
        if (i === contents.length - 1 && c.role === 'user') {
            const parts = c.parts.map((p, j) => {
                if (j === c.parts.length - 1 && p.text) {
                    return { text: p.text + additionalInstruction };
                }
                return p;
            });
            return { ...c, parts };
        }
        return c;
    });

    return await callGeminiWithRetry(retryContents, 3, true);
};

module.exports = { createSession, getSession, deleteSession, startChat, sendMessage, generateProfile, delay, callGeminiWithRetry, callGeminiWithRetryForSearchQuote };