require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.PROJECT_ID,
    location: process.env.LOCATION,
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
    1. 優先価値観（このテーマで何を大切にしているか）
    2. 独自の視点や経験（その人だから持っている視点）
    3. 得意分野（どの角度から議論に貢献できるか）
    4. リスク許容度（攻めの姿勢か慎重な姿勢か）

    【会話ルール】
    - 必ず日本語で話してください
    - 質問は一度に一つだけにしてください
    - 深掘りは1項目につき1回までにしてください
    - 最初に簡単な趣旨説明をしてから会話を始めてください
    - 引き出す項目をユーザーに直接説明しないでください
    - 自然な会話の流れで情報を引き出してください
    - 全項目が揃ったと判断したら、必ず「インタビューを終了します」という文言を含めて締めくくってください

    【注意】
    - 評価や批判はしないでください
    - 参加者の発言を否定しないでください
`;

// systemInstructionとthemeをもとにchatオブジェクトを作成して返す関数
const startChat = async (theme) => {
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
    const chat = getSession(socketId);
    const result = await chat.sendMessage({ message });
    return result.text;
}

// プロファイル生成の際に与えるシステムインストラクション
const generateProfileSystemInstruction = `
    あなたは会話分析AIです。
    与えられた会話履歴を分析してJSON形式のプロファイルを生成してください。
    JSONのみを返してください。余計な文字や\`\`\`は不要です。
`;

// プロファイル生成の際に与えるプロンプト
const generateProfilePrompt = (socketId, historyText) => `
    以下の会話履歴を分析して、このユーザーのプロファイルを以下のJSON形式で返してください。

    {
        "socketId": "${socketId}",
        "優先価値観": "このテーマで最も大切にしていること",
        "独自視点": "その人ならではの視点や経験",
        "得意分野": "議論に貢献できる専門領域や知識",
        "リスク許容度": "低 or 中 or 高",
        "主要主張": ["会話から読み取れる主張1", "主張2"],
        "発言スタイル": "論理的 or 感情的 or 両方"
    }

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

module.exports = { createSession, getSession, deleteSession, startChat, sendMessage, generateProfile };