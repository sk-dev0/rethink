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
    buildPhase3GammaPrompt,
    buildPhase4Turn1Prompt,
    buildPhase4Turn2Prompt,
} = require('./promptBuilders');
const {
    runCredibilityCheck,
    runCredibilityCheckStructured,
    checkAssumptionVerifiability,
    checkAssumptionInvalidation,
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
const { buildMindmapCode } = require('./mindmapService');
const {
    SUB_TOPIC_MAX,
    SEMANTIC_BRANCH_THRESHOLD,
    ASSUMPTION_VERIFIABILITY_THRESHOLD,
    ASSUMPTION_INVALIDATION_THRESHOLD,
    EVIDENCE_CREDIBILITY_THRESHOLD,
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

    // エビデンスログ初期化
    const evidenceLog = [];

    // 前提分類配列（フェーズ2 Step4以降で使用）
    let verifiableAssumptions = [];
    let unverifiableAssumptions = [];

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

    // Phase2-Step1 完了後: エビデンス蓄積（構造化信頼性チェック）
    const phase2StructuredCheck = await runCredibilityCheckStructured(phase2Research);
    for (const [label, scoreData] of Object.entries(phase2StructuredCheck.scores)) {
        if ((scoreData['平均'] || 0) >= EVIDENCE_CREDIBILITY_THRESHOLD) {
            const agentRes = phase2Research.find(r => r.label === label);
            evidenceLog.push({
                phase: 'Phase2-Step1',
                agentLabel: label,
                text: agentRes ? agentRes.text.slice(0, 200) : '',
                avgScore: scoreData['平均'],
            });
        }
    }

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

    // Step 4 完了後: 前提分類処理
    const assumptions = extractionResult.assumptions || [];
    console.log('[Phase2-Step4] 抽出された前提一覧:', JSON.stringify(assumptions, null, 2));
    if (assumptions.length > 0) {
        for (const assumption of assumptions) {
            const score = await checkAssumptionVerifiability(assumption.content);
            console.log(`[Phase2-Step4] 前提「${assumption.content}」検証可能性スコア: ${score}`);
            if (score >= ASSUMPTION_VERIFIABILITY_THRESHOLD) {
                verifiableAssumptions.push(assumption);
            } else {
                unverifiableAssumptions.push(assumption);
            }
            await delay(1000);
        }
    }

    const phase2Result = {
        research: phase2Research,
        credibility: credibilityText,
        rebuttals: phase2Rebuttals,
        subTopics,
        decomposition,
    };
    console.log('[Phase2] 完了');

    // =============================
    // フェーズ3: サブ議題別議論 & γ専用トラック（並行実行）
    // =============================
    console.log('[Phase3] 開始');
    console.log('[Phase3-Gamma] γ専用トラック 開始');

    const phase3Results = [];
    let currentBatch = subTopics; // depth0のサブ議題が最初のバッチ

    // γトラック: 各前提に対するAPI呼び出しをPromise配列として構築（whileループと並行実行）
    if (verifiableAssumptions.length === 0) {
        console.log('[Phase3-Gamma] 検証可能前提なし スキップ');
    }
    const gammaTrackPromise = verifiableAssumptions.length > 0
        ? Promise.allSettled(
            verifiableAssumptions.map(async (assumption) => {
                console.log(`[Phase3-Gamma] 前提「${assumption.content}」処理中`);

                // 全エージェントのγ攻撃を並行生成
                const gammaAgentResults = await Promise.allSettled(
                    agents.map(async (agent) => {
                        const prompt = buildPhase3GammaPrompt(agent, assumption.content);
                        const contents = [{ role: 'user', parts: [{ text: prompt }] }];
                        let text = await callGeminiWithRetry(contents, 3, true);
                        text = await callGeminiWithRetryForSearchQuote(text, contents);
                        return { label: agent.label, text: text || '（生成失敗）' };
                    })
                );

                const gammaUtterances = gammaAgentResults
                    .filter(r => r.status === 'fulfilled')
                    .map(r => r.value);

                // 信頼性チェック
                const { text: gammaCredibilityText, scores: gammaScores } = await runCredibilityCheckStructured(gammaUtterances);

                // evidenceLogへ追記（シングルスレッドのため競合なし）
                for (const [label, scoreData] of Object.entries(gammaScores)) {
                    if ((scoreData['平均'] || 0) >= EVIDENCE_CREDIBILITY_THRESHOLD) {
                        const agentUtterance = gammaUtterances.find(u => u.label === label);
                        evidenceLog.push({
                            phase: 'Phase3-gamma',
                            agentLabel: label,
                            text: agentUtterance ? agentUtterance.text.slice(0, 200) : '',
                            avgScore: scoreData['平均'],
                        });
                    }
                }

                // 反証成立度スコアリング
                const gammaAttackText = gammaUtterances
                    .map(u => `${u.label}: ${u.text}`)
                    .join('\n');
                const invalidationScore = await checkAssumptionInvalidation(
                    assumption.content,
                    gammaAttackText,
                    gammaCredibilityText
                );

                return {
                    assumption,
                    gammaUtterances,
                    invalidationScore,
                    invalidated: invalidationScore >= ASSUMPTION_INVALIDATION_THRESHOLD,
                };
            })
        )
        : Promise.resolve([]);

    // whileループをPromiseとして構築（γトラックと並行実行）
    const phase3Promise = (async () => {
        while (currentBatch.length > 0) {
            console.log(`[Phase3] バッチ処理 depth=${currentBatch[0]?.depth}, 件数=${currentBatch.length}`);

            const batchResults = await Promise.allSettled(
                currentBatch.map(subTopic => processSubTopic(subTopic, agents, clampedTurns, evidenceLog))
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
    })();

    // whileループとγトラックを並行待機
    const [, gammaSettled] = await Promise.allSettled([phase3Promise, gammaTrackPromise]);
    const gammaRawResults = (gammaSettled.status === 'fulfilled') ? gammaSettled.value : [];

    // subTopicConclusions生成（phase3Results完了後）
    const subTopicConclusions = phase3Results.map(r => ({
        title: r.subTopic.title,
        conclusion: r.discussionLog.length > 0
            ? (r.discussionLog[r.discussionLog.length - 1].utterances || [])
                .map(u => `${u.label}: ${u.text}`)
                .join('\n')
            : '（議論なし）',
    }));

    // assumptionDebateLog構築とshakenFlag付与（両Promise完了後）
    const assumptionDebateLog = [];
    for (const result of gammaRawResults) {
        if (result.status === 'fulfilled') {
            const { assumption, gammaUtterances, invalidationScore, invalidated } = result.value;

            // 反証成立時: 依存エージェントが登場するサブ議題結論にshakenFlagを付与
            if (invalidated) {
                for (const dependentLabel of (assumption.dependsOn || [])) {
                    for (const conclusion of subTopicConclusions) {
                        const phase3Entry = phase3Results.find(r => r.subTopic.title === conclusion.title);
                        if (phase3Entry) {
                            const appearsInLog = phase3Entry.discussionLog.some(entry =>
                                (entry.utterances || []).some(u => u.label === dependentLabel)
                            );
                            if (appearsInLog) {
                                conclusion.shakenFlag = true;
                                conclusion.invalidationReason = `前提「${assumption.content}」に対する反証スコア: ${invalidationScore}`;
                            }
                        }
                    }
                }
            }

            assumptionDebateLog.push({
                id: assumption.id,
                content: assumption.content,
                invalidationScore,
                invalidated,
                gammaUtterances,
            });
        }
    }

    // shakenConclusions抽出
    const shakenConclusions = subTopicConclusions.filter(s => s.shakenFlag === true);

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
            const prompt = buildPhase4Turn1Prompt(agent, subTopicSummariesText, shakenConclusions);
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
            const prompt = buildPhase4Turn2Prompt(agent, subTopicSummariesText, otherTurn1Texts, shakenConclusions);
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
    const validatedEvidenceList = evidenceLog.filter(e => e.avgScore >= EVIDENCE_CREDIBILITY_THRESHOLD);
    const finalSummary = await runFinalSummary(
        topic,
        agents,
        decomposition,
        subTopicConclusions,
        synthesisRound,
        validatedEvidenceList,
        unverifiableAssumptions,
        assumptionDebateLog
    );

    const phase4Result = {
        synthesis: synthesisRound,
        finalSummary,
    };

    console.log('[Phase4] 完了');

    // =============================
    // マインドマップ生成
    // =============================
    console.log('[Mindmap] マインドマップ生成');
    const partialResult = {
        phase1: phase1Results,
        phase2: phase2Result,
        phase3: phase3Results,
        phase4: phase4Result,
        assumptionDebateLog,
    };
    const { mindmap1, mindmap2 } = await buildMindmapCode(topic, agents, partialResult);

    return {
        ...partialResult,
        mindmap1,
        mindmap2,
    };
};

/**
 * 各サブ議題の議論処理
 * @param {object} subTopic - { id, title, reason, depth }
 * @param {Array} agents
 * @param {number} maxTurns
 * @param {Array} evidenceLog - 参照渡しのエビデンスログ配列
 * @returns {Promise<{subTopic, discussionLog, subSubTopics}>}
 */
const processSubTopic = async (subTopic, agents, maxTurns, evidenceLog) => {
    const discussionLog = [];
    let discussedTopics = [];
    const subSubTopics = [];
    let prevUtterances = null;

    for (let turn = 0; turn < maxTurns; turn++) {
        const discussedTopicsStr = topicsToString(discussedTopics);

        console.log(`[Phase3] サブ議題「${subTopic.title}」ターン${turn + 1} αサブステップ`);

        // αサブステップ: 全エージェントの発言を並行生成（enableSearch=true）
        const alphaResults = await Promise.allSettled(
            agents.map(async (agent) => {
                const prompt = buildPhase3Prompt(
                    agent,
                    subTopic.title,
                    discussionLog,
                    'α',
                    discussedTopicsStr
                );
                const contents = [{ role: 'user', parts: [{ text: prompt }] }];
                let text = await callGeminiWithRetry(contents, 3, true);
                text = await callGeminiWithRetryForSearchQuote(text, contents);
                return { label: agent.label, text: text || '（生成失敗）' };
            })
        );

        const alphaUtterances = alphaResults
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        // αのエビデンス蓄積
        const { text: alphaCredibilityText, scores: alphaScores } = await runCredibilityCheckStructured(alphaUtterances);
        for (const [label, scoreData] of Object.entries(alphaScores)) {
            if ((scoreData['平均'] || 0) >= EVIDENCE_CREDIBILITY_THRESHOLD) {
                const agentUtterance = alphaUtterances.find(u => u.label === label);
                evidenceLog.push({
                    phase: 'Phase3-alpha',
                    agentLabel: label,
                    text: agentUtterance ? agentUtterance.text.slice(0, 200) : '',
                    avgScore: scoreData['平均'],
                });
            }
        }

        await delay(1000);

        console.log(`[Phase3] サブ議題「${subTopic.title}」ターン${turn + 1} βサブステップ`);

        // βサブステップ: 全エージェントの発言を並行生成（enableSearch=false、alphaCredibilityText注入）
        const betaResults = await Promise.allSettled(
            agents.map(async (agent) => {
                const prompt = buildPhase3Prompt(
                    agent,
                    subTopic.title,
                    discussionLog,
                    'β',
                    discussedTopicsStr,
                    alphaCredibilityText
                );
                const contents = [{ role: 'user', parts: [{ text: prompt }] }];
                const text = await callGeminiWithRetry(contents, 3, false);
                return { label: agent.label, text: text || '（生成失敗）' };
            })
        );

        const betaUtterances = betaResults
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        // discussionLogにαとβをそれぞれ追加
        discussionLog.push({ turn: turn + 1, attackMode: 'α', subStep: 'α', utterances: alphaUtterances });
        discussionLog.push({ turn: turn + 1, attackMode: 'β', subStep: 'β', utterances: betaUtterances });

        // 議論済み論点リストをAIで更新（betaUtterancesを使用）
        const newTopics = await extractTopicsFromUtterances(betaUtterances);
        discussedTopics = addTopicsToList(discussedTopics, newTopics);

        // ターン2以降、かつdepthが2未満の場合にセマンティック分岐を判定（betaUtterancesを使用）
        if (turn >= 1 && prevUtterances && subTopic.depth < 1) {
            const prevTexts = prevUtterances.map(u => `${u.label}: ${u.text}`);
            const currentTexts = betaUtterances.map(u => `${u.label}: ${u.text}`);
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

        prevUtterances = betaUtterances;
        await delay(1000);
    }

    return { subTopic, discussionLog, subSubTopics };
};

module.exports = { runDebate };
