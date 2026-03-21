/**
 * topicTracker.js
 * 議論済み論点リストの管理を担う
 */

const { callGeminiWithRetry } = require('./geminiClient');
const { TOPIC_LIST_MAX } = require('./constants');

/**
 * 発言群から論点を意味的にまとまった単位で最大5件抽出する
 * @param {Array<{label: string, text: string}>} utterances - 発言の配列
 * @returns {Promise<string[]>} 論点の配列（10〜30文字の名詞句）
 */
const extractTopicsFromUtterances = async (utterances) => {
    if (!utterances || utterances.length === 0) return [];

    const utterancesText = utterances
        .map(u => `${u.label}: ${u.text}`)
        .join('\n');

    const prompt = `以下の発言群から、議論で扱われた論点を意味的にまとまった単位で最大5件抽出してください。

【発言】
${utterancesText}

【出力形式】
- 各論点は10文字以上30文字以下の名詞句で記述すること
- 1行に1件だけ記述すること
- 番号や記号は不要
- 日本語で記述すること
- 論点が5件未満の場合はその数だけ出力すること`;

    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    if (!result) return [];

    const lines = result.split('\n')
        .map(l => l.trim())
        .filter(l => l.length >= 10 && l.length <= 30);

    return lines.slice(0, 5);
};

/**
 * 論点を重複チェックしながら議論済みリストに追加する
 * 最大保持件数を超えた場合は古いものから削除
 * @param {string[]} list - 現在の議論済み論点リスト
 * @param {string[]} newTopics - 新たに追加する論点の配列
 * @returns {string[]} 更新後のリスト
 */
const addTopicsToList = (list, newTopics) => {
    const updated = [...list];
    for (const topic of newTopics) {
        if (!updated.includes(topic)) {
            updated.push(topic);
        }
    }
    // 最大保持件数を超えた場合は古いものから削除
    while (updated.length > TOPIC_LIST_MAX) {
        updated.shift();
    }
    return updated;
};

/**
 * 論点リストを日本語のカンマ区切り文字列に変換する
 * @param {string[]} list - 論点リスト
 * @returns {string} カンマ区切りの文字列
 */
const topicsToString = (list) => {
    return list.join('、');
};

module.exports = {
    extractTopicsFromUtterances,
    addTopicsToList,
    topicsToString,
};
