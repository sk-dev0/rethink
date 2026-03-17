require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.PROJECT_ID,
    location: process.env.LOCATION,
});

const chatSessions = {};

const createSession = async (socketId) => {
    const chat = await startChat();
    chatSessions[socketId] = chat;
};

const getSession = (socketId) => {
    return chatSessions[socketId];
};

const deleteSession  =(socketId) => {
    delete chatSessions[socketId];
};

//chat.createは非同期関数ではないのでasync不要だと判断。どうだ？
const startChat =  () => {
    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: 'あなたはインタビュアーです',
        },
    });
    return chat;
};

const sendMessage = async (socketId, message) => {
    if (!chat) {
        throw new Error(`ソケットIDが見つかりませんでした。socketId: ${socketId}`);
    }
    //getSessionがsocketIdを見つけられなかった際のエラーハンドリングを追加
    const chat = getSession(socketId);
    const result = await chat.sendMessage({ message });
    return result.text;
}

module.exports = { createSession, getSession, deleteSession, startChat, sendMessage };