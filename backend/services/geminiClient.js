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

const startChat = async () => {
    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: 'あなたはインタビュアーです',
        },
    });
    return chat;
};

const sendMessage = async (socketId, message) => {
    const chat = getSession(socketId);
    const result = await chat.sendMessage({ message });
    return result.text;
}

module.exports = { createSession, getSession, deleteSession, startChat, sendMessage };