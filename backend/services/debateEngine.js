/**
 * debateEngine.js
 * フェーズ1〜4までの実行制御を担うメインオーケストレーター
 */

const { callGeminiWithRetry, callGeminiWithRetryForSearchQuote, delay } = require('./geminiClient');
const {
    buildPhase1Prompt,
    buildPhase2Step1Prompt,
    buildPhase2Step3Prompt,
    buildPhase3Prompt,
    buildPhase4Turn1Prompt,
    buildPhase4Turn2Prompt,
} = require('./promptBuilders');
const {
    runCredibilityCheck,
    runSubTopicExtraction,
    checkSemanticBranch,
    extractSubSubTopics,
} = require('./moderatorService');
const {
    extractTopicsFromUtterances,
    addTopicsToList,
    topicsToString,
} = require('./topicTracker');
const { runFinalSummary } = require('./resultService');
const {
    SUB_TOPIC_MAX,
    PHASE3_ATTACK_MODES,
    SEMANTIC_BRANCH_THRESHOLD,
} = require('./constants');

/**
 * メインの議論実行関数
 * @param {string} topic - 議題
 * @param {Array<{label, coreClaim, rationale, preconditions, experience?}>} agents - エージェント配列
 * @param {number} maxTurns - フェーズ3のサブ議題あたり最大ターン数（1〜4にクランプ）
 * @returns {Promise<object>} 各フェーズの結果をまとめたオブジェクト
 */
const runDebate = async (topic, agents, maxTurns) => {
    // maxTurnsを1〜4にクランプ（0/null/undefinedはデフォルト2）
    const _raw = parseInt(maxTurns, 10);
    const clampedTurns = Math.max(1, Math.min(4, isNaN(_raw) ? 2 : _raw));

    // =============================
    // フェーズ1: 立場表明
    // =============================
    console.log('[Phase1] 立場表明 開始');
    const phase1Results = (await Promise.allSettled(
        agents.map(async (agent) => {
            const prompt = buildPhase1Prompt(agent);
            const contents = [{ role: 'user', parts: [{ text: prompt }] }];
            const text = await callGeminiWithRetry(contents);
            return { label: agent.label, text: text || '（生成失敗）' };
        })
    )).map((r, i) =>
        r.status === 'fulfilled'
            ? r.value
            : { label: agents[i].label, text: '（生成失敗）' }
    );
    console.log('[Phase1] 完了');

    // =============================
    // フェーズ2: 情報取得・反論・サブ議題抽出
    // =============================
    console.log('[Phase2] 開始');

    // Step 1: 全エージェントのウェブ検索による情報取得
    console.log('[Phase2-Step1] 情報取得');
    const phase2Research = (await Promise.allSettled(
        agents.map(async (agent) => {
            const otherAgents = agents.filter(a => a.label !== agent.label);
            const prompt = buildPhase2Step1Prompt(agent, otherAgents);
            const contents = [{ role: 'user', parts: [{ text: prompt }] }];
            const text = await callGeminiWithRetry(contents, 3, true);
            return { label: agent.label, text: text || '（情報取得失敗）' };
        })
    )).map((r, i) =>
        r.status === 'fulfilled'
            ? r.value
            : { label: agents[i].label, text: '（情報取得失敗）' }
    );

    // Step 2: 信頼性検証（中立AIが一回だけ実行）
    console.log('[Phase2-Step2] 信頼性検証');
    const credibilityText = await runCredibilityCheck(phase2Research);
    await delay(1000);

    // Step 3: 全対全反論（N×(N-1)通り）
    console.log('[Phase2-Step3] 全対全反論');
    const rebuttalPairs = agents.flatMap(attacker =>
        agents
            .filter(defender => attacker.label !== defender.label)
            .map(defender => ({ attacker, defender }))
    );
    const phase2Rebuttals = (await Promise.allSettled(
        rebuttalPairs.map(async ({ attacker, defender }) => {
            const attackerResearch = phase2Research.find(r => r.label === attacker.label);
            const attackerInfo = {
                ...attacker,
                researchText: attackerResearch ? attackerResearch.text : '',
            };
            const defenderOpening = phase1Results.find(r => r.label === defender.label)?.text || '';
            const prompt = buildPhase2Step3Prompt(attackerInfo, defender, credibilityText, defenderOpening);
            const contents = [{ role: 'user', parts: [{ text: prompt }] }];
            const text = await callGeminiWithRetry(contents);
            return { attacker: attacker.label, defender: defender.label, text: text || '（反論生成失敗）' };
        })
    )).map((r, i) =>
        r.status === 'fulfilled'
            ? r.value
            : { attacker: rebuttalPairs[i].attacker.label, defender: rebuttalPairs[i].defender.label, text: '（反論生成失敗）' }
    );

    // Step 4: サブ議題抽出と要素分解
    console.log('[Phase2-Step4] サブ議題抽出');
    const rebuttalTexts = phase2Rebuttals.map(r =>
        `[${r.attacker} → ${r.defender}]\n${r.text}`
    );
    const extractionResult = await runSubTopicExtraction(rebuttalTexts);

    const rawSubTopics = (extractionResult.subTopics || []).slice(0, SUB_TOPIC_MAX);
    const subTopics = rawSubTopics.map((st, i) => ({
        id: `sub_${i}`,
        title: st.title || `サブ議題${i + 1}`,
        reason: st.reason || '',
        depth: 0,
    }));
    const decomposition = extractionResult.decomposition || {};

    const phase2Result = {
        research: phase2Research,
        credibility: credibilityText,
        rebuttals: phase2Rebuttals,
        subTopics,
        decomposition,
    };
    console.log('[Phase2] 完了');

    // =============================
    // フェーズ3: サブ議題別議論（深さ階層ごとにバッチ並行処理）
    // =============================
    console.log('[Phase3] 開始');

    const phase3Results = [];
    let currentBatch = subTopics; // depth0のサブ議題が最初のバッチ

    while (currentBatch.length > 0) {
        console.log(`[Phase3] バッチ処理 depth=${currentBatch[0]?.depth}, 件数=${currentBatch.length}`);

        const batchResults = await Promise.allSettled(
            currentBatch.map(subTopic => processSubTopic(subTopic, agents, clampedTurns))
        );

        const nextBatch = [];

        for (const result of batchResults) {
            if (result.status === 'fulfilled') {
                phase3Results.push(result.value);
                // サブサブ議題を次のバッチに追加
                if (result.value.subSubTopics && result.value.subSubTopics.length > 0) {
                    nextBatch.push(...result.value.subSubTopics);
                }
            } else {
                console.error('[Phase3] サブ議題処理失敗:', result.reason);
            }
        }

        currentBatch = nextBatch;
    }

    console.log('[Phase3] 完了');

    // サブ議題の結論サマリーを生成（フェーズ4で使用）
    const subTopicConclusions = phase3Results.map(r => ({
        title: r.subTopic.title,
        conclusion: r.discussionLog.length > 0
            ? (r.discussionLog[r.discussionLog.length - 1].utterances || [])
                .map(u => `${u.label}: ${u.text}`)
                .join('\n')
            : '（議論なし）',
    }));

    const subTopicSummariesText = subTopicConclusions
        .map(s => `【${s.title}】\n${s.conclusion}`)
        .join('\n\n');

    // =============================
    // フェーズ4: 統合表明とまとめ
    // =============================
    console.log('[Phase4] 開始');

    // Step 1 ターン1: 全エージェントが独立に統合表明
    console.log('[Phase4-Step1-Turn1] 統合表明ターン1');
    const phase4Turn1 = (await Promise.allSettled(
        agents.map(async (agent) => {
            const prompt = buildPhase4Turn1Prompt(agent, subTopicSummariesText);
            const contents = [{ role: 'user', parts: [{ text: prompt }] }];
            const text = await callGeminiWithRetry(contents);
            return { label: agent.label, text: text || '（生成失敗）' };
        })
    )).map((r, i) =>
        r.status === 'fulfilled'
            ? r.value
            : { label: agents[i].label, text: '（生成失敗）' }
    );

    // Step 1 ターン2: 全エージェントがターン1の完成済み結果を参照して同時に統合表明
    console.log('[Phase4-Step1-Turn2] 統合表明ターン2');
    const phase4Turn2 = (await Promise.allSettled(
        agents.map(async (agent) => {
            const otherTurn1Texts = phase4Turn1
                .filter(u => u.label !== agent.label)
                .map(u => `${u.label}の統合表明: ${u.text}`);
            const prompt = buildPhase4Turn2Prompt(agent, subTopicSummariesText, otherTurn1Texts);
            const contents = [{ role: 'user', parts: [{ text: prompt }] }];
            const text = await callGeminiWithRetry(contents);
            return { label: agent.label, text: text || '（生成失敗）' };
        })
    )).map((r, i) =>
        r.status === 'fulfilled'
            ? r.value
            : { label: agents[i].label, text: '（生成失敗）' }
    );

    // Step 2: 最終まとめ（中立AIが一回だけ生成）
    console.log('[Phase4-Step2] 最終まとめ生成');
    const synthesisRound = { turn1: phase4Turn1, turn2: phase4Turn2 };
    const finalSummary = await runFinalSummary(
        topic,
        agents,
        decomposition,
        subTopicConclusions,
        synthesisRound
    );

    const phase4Result = {
        synthesis: synthesisRound,
        finalSummary,
    };

    console.log('[Phase4] 完了');

    return {
        phase1: phase1Results,
        phase2: phase2Result,
        phase3: phase3Results,
        phase4: phase4Result,
    };
};

/**
 * 各サブ議題の議論処理
 * @param {object} subTopic - { id, title, reason, depth }
 * @param {Array} agents
 * @param {number} maxTurns
 * @returns {Promise<{subTopic, discussionLog, subSubTopics}>}
 */
const processSubTopic = async (subTopic, agents, maxTurns) => {
    const discussionLog = [];
    let discussedTopics = [];
    const subSubTopics = [];
    let prevUtterances = null;

    for (let turn = 0; turn < maxTurns; turn++) {
        const attackMode = PHASE3_ATTACK_MODES[turn % PHASE3_ATTACK_MODES.length];
        const discussedTopicsStr = topicsToString(discussedTopics);

        console.log(`[Phase3] サブ議題「${subTopic.title}」ターン${turn + 1} 攻撃モード:${attackMode}`);

        // 全エージェントの発言を並行生成
        const utteranceResults = await Promise.allSettled(
            agents.map(async (agent) => {
                const prompt = buildPhase3Prompt(
                    agent,
                    subTopic.title,
                    discussionLog,
                    attackMode,
                    discussedTopicsStr
                );
                const contents = [{ role: 'user', parts: [{ text: prompt }] }];

                let text = await callGeminiWithRetry(contents, 3, attackMode === 'α');

                // αの攻撃モードで検索引用がない場合は再呼び出し
                if (attackMode === 'α') {
                    text = await callGeminiWithRetryForSearchQuote(text, contents);
                }

                return { label: agent.label, text: text || '（生成失敗）' };
            })
        );

        const currentUtterances = utteranceResults
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        discussionLog.push({ turn: turn + 1, attackMode, utterances: currentUtterances });

        // 議論済み論点リストをAIで更新
        const newTopics = await extractTopicsFromUtterances(currentUtterances);
        discussedTopics = addTopicsToList(discussedTopics, newTopics);

        // ターン2以降、かつdepthが2未満の場合にセマンティック分岐を判定
        if (turn >= 1 && prevUtterances && subTopic.depth < 1) {
            const prevTexts = prevUtterances.map(u => `${u.label}: ${u.text}`);
            const currentTexts = currentUtterances.map(u => `${u.label}: ${u.text}`);
            const branchScore = await checkSemanticBranch(prevTexts, currentTexts);

            console.log(`[Phase3] 分岐スコア: ${branchScore} (閾値: ${SEMANTIC_BRANCH_THRESHOLD})`);

            if (branchScore >= SEMANTIC_BRANCH_THRESHOLD) {
                const newSubSubTopics = await extractSubSubTopics(currentTexts, subTopic.title);
                const formattedSubSubTopics = newSubSubTopics.map((st, i) => ({
                    id: `${subTopic.id}_sub_${i}`,
                    title: st.title || `サブサブ議題${i + 1}`,
                    reason: st.reason || '',
                    depth: subTopic.depth + 1,
                    parentId: subTopic.id,
                }));
                subSubTopics.push(...formattedSubSubTopics);
                console.log(`[Phase3] サブサブ議題を${formattedSubSubTopics.length}件追加`);
            }
        }

        prevUtterances = currentUtterances;
        await delay(1000);
    }

    return { subTopic, discussionLog, subSubTopics };
};

module.exports = { runDebate };
