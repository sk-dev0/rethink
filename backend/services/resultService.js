/**
 * resultService.js
 * フェーズ4ステップ2の最終まとめプロンプト生成と実行を担う
 */

const { callGeminiWithRetry } = require('./geminiClient');

/**
 * フェーズ4ステップ2: 最終まとめプロンプト生成
 * @param {string} topic - 議題
 * @param {Array} agents - 全エージェント情報
 * @param {object} decomposition - 要素分解結果
 * @param {Array<{title: string, conclusion: string}>} subTopicConclusions - 全サブ議題の結論
 * @param {object} synthesisRound - 統合表明ラウンドの発言（t * @param {Array} [validatedEvidenceList=[]] - 検証済みエビデンス配列
 * @param {Array} [unverifiableAssumptions=[]] - 検証不可能前提配列
 * @param {Array} [assumptionDebateLog=[]] - 前提検証トラックログ配列
 * @returns {string} プロンプト文字列
 */
const buildFinalSummaryPrompt = (topic, agents, decomposition, subTopicConclusions, synthesisRound, validatedEvidenceList = [], unverifiableAssumptions = [], assumptionDebateLog = []) => {
    const agentList = agents.map(a => `- ${a.label}: ${a.coreClaim}`).join('\n');

    const decompositionText = Object.entries(decomposition || {})
        .map(([label, data]) => {
            const points = (data.mainPoints || []).join('、');
            const evidence = (data.evidence || []).join('、');
            const values = (data.valuePremises || []).join('、');
            return `${label}: 論点[${points}] 根拠[${evidence}] 価値前提[${values}]`;
        }).join('\n');

    const conclusionText = (subTopicConclusions || [])
        .map(s => `【${s.title}】\n${s.conclusion}`)
        .join('\n\n');

    const turn1Text = (synthesisRound.turn1 || [])
        .map(u => `${u.label}: ${u.text}`)
        .join('\n\n');

    const turn2Text = (synthesisRound.turn2 || [])
        .map(u => `${u.label}: ${u.text}`)
        .join('\n\n');

    // 注入セクション1: 検証済みエビデンス一覧
    let evidenceSection = '';
    if (validatedEvidenceList && validatedEvidenceList.length > 0) {
        const evidenceList = validatedEvidenceList
            .map(e => `・[${e.phase}] ${e.agentLabel}: ${e.text}`)
            .join('\n');
        evidenceSection = `\n【検証済みエビデンス一覧】
${evidenceList}
見出し1の解決済み争点と見出し2の妥協案において各主張や結論を記述する際、対応するエビデンスが存在する場合は末尾に括弧書きで「根拠:フェーズ名・エージェントラベルの取得情報」と付記すること。対応するエビデンスが存在しない主張や譲歩点の末尾には括弧書きで「根拠未検証」と付記すること。\n`;
    }

    // 注入セクション2: 動揺フラグ付き結論一覧
    let shakenSection = '';
    const invalidatedAssumptions = (assumptionDebateLog || []).filter(e => e.invalidated === true);
    if (invalidatedAssumptions.length > 0) {
        const shakenList = invalidatedAssumptions
            .map(e => `・前提「${e.content}」（反証スコア: ${e.invalidationScore}）`)
            .join('\n');
        shakenSection = `\n【動揺フラグ付き結論一覧】
${shakenList}
見出し2の妥協案においてこれらの前提に依存する結論を取り上げる際は、その結論が有効となる条件（当該前提が成立する場合に限り有効）を括弧書きで明示し、反証スコアも括弧内に併記すること。\n`;
    }

    // 注入セクション3: 検証不可能前提一覧
    let unverifiableSection = '';
    if (unverifiableAssumptions && unverifiableAssumptions.length > 0) {
        const unverifiableList = unverifiableAssumptions
            .map(a => `・前提「${a.content}」（依存エージェント: ${(a.dependsOn || []).join('、')}）`)
            .join('\n');
        unverifiableSection = `\n【検証不可能前提一覧】
${unverifiableList}
これらの前提はデータで決着がつかない価値判断に基づくため、見出し3の人間が最終判断すべき残存論点に優先的に含めること。\n`;
    }

    return `あなたは議論の構造分析を専門とする中立的なモデレーターである。
以下の情報を元に、感情・修辞を排除して論理構造のみで分析せよ。感想・評価・応援は一切禁止する。

【議題】
以下の議題を分析の前提として使用すること。
${topic}

【各アイデアの主張】
以下の各主張を出力の4セクションにおける論点整理の基軸として使用すること。
${agentList}

【要素分解結果】
以下の要素分解結果を見出し2の妥協案生成に活用し、各アイデアの要素を組み合わせた現実的な妥協案を導出すること。
${decompositionText || '（要素分解なし）'}

【各サブ議題の結論】
以下の各サブ議題の結論を参照し、見出し1の解決済み争点と見出し3の残存論点の判定根拠として使用すること。
${conclusionText}

【統合表明ターン1】
以下の各エージェントの独立した統合表明を参照し、各アイデアが維持した主張と譲歩した点を見出し1・見出し2の分析に活用すること。
${turn1Text}

【統合表明ターン2】
以下の各エージェントの相互参照後の統合表明を参照し、ターン1からの変化を見出し2・見出し3の分析に活用すること。
${turn2Text}
${evidenceSection}${shakenSection}${unverifiableSection}
---

以下の4セクションを順番に、見出しを明記した上で出力せよ。

見出し1: 解決済み争点
以下のいずれかに該当する論点を「解決済み」として列挙せよ。

第一に、統合表明ターン2において複数のエージェントが
同一の結論を明示的に受け入れた論点。

第二に、動揺フラグにより前提が崩れたことで
一方の主張が成立しなくなり、論点自体が消滅した論点。

第三に、統合表明ターン2において対立していた
いずれかのエージェントが相手の主張の一部を
明示的に認め、その論点についてそれ以上反論しなかった論点。

各論点について以下の形式で記述すること。
「論点: [元の対立内容]
決着: [どのエージェントが何を認めたか]
根拠: [統合表明ターン2の該当発言を特定すること]」

根拠となる発言が特定できない論点は記載しないこと。
「共通認識が形成された」等の根拠を伴わない
抽象的な表現のみでの記述を禁止する。

見出し2: 妥協案が成立する領域
アイデアの要素分解結果を活用し、現実的な妥協案を1つ提示せよ。妥協案は「何を優先するか」と「何を切るか」の両方を明示した上で構成すること。各アイデアの要素を単純に合体させることを禁止する。優先する要素とその理由、切り捨てる要素とその理由を具体的に記述した上で、結果として成立する一貫した方針を提示すること。

見出し3: 人間が最終判断すべき残存論点
見出し2の妥協案を確定方針とした上で、なお決着がつかない価値判断を伴う論点を列挙せよ。妥協案で棄却済みまたは決着済みの論点の再提示を禁止する。各論点は「AかBか」の選択、「Xをどこまで許容するか」の閾値判断、「前提Yを受け入れるか否か」の採否判断のいずれかの形式で記述すること。検証不可能前提一覧の各前提は「この前提を受け入れるか否か」の形式で含めること。

見出し4: 推奨アクション
見出し3に列挙した残存論点見出し3に列挙した残存論点の各項目と、検証不可能前提一覧の各項目に対して、それぞれ人間が判断するために取るべき具体的な行動を1件のみ提示すること。各行動は「誰が（役職またはロールを具体的に）」「何を（具体的なアウトプット名または意思決定内容を）」「どのような方法で（調査手法・議論の場・検証手段を具体的に）」の3要素を全て含むこと。「ユーザーニーズを調査する」「関係者に確認する」のような抽象的な提案は禁止する。どの残存論点または検証不可能前提に対応するアクションかを明示すること。議題の規模感と想定される実行者のリソースに見合ったアクションに限定すること。

【制約】
- マークダウン記法（アスタリスク、ハイフンのリスト記号、スラッシュ）を一切使用せず、自然な日本語文章として出力せよ。
- スコアの数値（反証スコア、検証可能性スコア等）を出力文中に一切記載しないこと。スコアは内部判断の根拠として使用するが、ユーザー向けの文章には含めない。`;
};
/**
 * 最終まとめをAIに実行させる
 * @param {string} topic
 * @param {Array} agents
 * @param {object} decomposition
 * @param {Array} subTopicConclusions
 * @param {object} synthesisRound
 * @param {Array} [validatedEvidenceList=[]]
 * @param {Array} [unverifiableAssumptions=[]]
 * @param {Array} [assumptionDebateLog=[]]
 * @returns {Promise<string>} 総括テキスト
 */
const runFinalSummary = async (topic, agents, decomposition, subTopicConclusions, synthesisRound, validatedEvidenceList = [], unverifiableAssumptions = [], assumptionDebateLog = []) => {
    const prompt = buildFinalSummaryPrompt(topic, agents, decomposition, subTopicConclusions, synthesisRound, validatedEvidenceList, unverifiableAssumptions, assumptionDebateLog);
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const result = await callGeminiWithRetry(contents);
    return result || '（最終総括を生成できませんでした）';
};

module.exports = {
    buildFinalSummaryPrompt,
    runFinalSummary,
};
