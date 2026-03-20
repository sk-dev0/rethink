/**
 * main.js
 * AI Debate フロントエンド処理
 * - 入力収集、POST送信、JSON描画
 * - XSS対策として、文字列はエスケープしてから innerHTML へ入れる
 */

/* =============================
   ユーティリティ
============================= */

const esc = (str) => {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const cleanSummary = (text) => {
    if (!text) return text;
    return text
        .replace(/\*/g, '')
        .replace(/^-\s+/gm, '')
        .replace(/([\u3000-\u9FFF\uFF00-\uFFEF])\/([\u3000-\u9FFF\uFF00-\uFFEF])/g, '$1$2');
};

const createAccordionItem = (parentId, itemId, title, bodyHtml, expanded = false) => {
    const showClass = expanded ? 'show' : '';
    const collapsedClass = expanded ? '' : 'collapsed';
    return `
<div class="accordion-item">
  <h2 class="accordion-header" id="heading_${esc(itemId)}">
    <button class="accordion-button ${collapsedClass}" type="button"
      data-bs-toggle="collapse"
      data-bs-target="#collapse_${esc(itemId)}"
      aria-expanded="${expanded}"
      aria-controls="collapse_${esc(itemId)}">
      ${esc(title)}
    </button>
  </h2>
  <div id="collapse_${esc(itemId)}"
    class="accordion-collapse collapse ${showClass}"
    aria-labelledby="heading_${esc(itemId)}"
    data-bs-parent="#${esc(parentId)}">
    <div class="accordion-body">
      ${bodyHtml}
    </div>
  </div>
</div>`;
};

const preText = (text) => `<p style="white-space:pre-wrap;">${esc(text)}</p>`;

/* =============================
   エージェント追加
============================= */

const AGENT_COLORS = ['primary', 'danger', 'success', 'warning', 'info', 'secondary'];
const AGENT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const reindexAgents = () => {
    const container = document.getElementById('agentsContainer');
    const cols = container.querySelectorAll('.agent-col');
    cols.forEach((c, idx) => {
        c.dataset.index = idx;
        const card = c.querySelector('.agent-card');
        if (!card) return;
        card.dataset.agentIndex = idx;

        const label = AGENT_LABELS[idx] || `Agent${idx}`;
        const newColor = AGENT_COLORS[idx % AGENT_COLORS.length];
        const oldColor = AGENT_COLORS.find((col) =>
            card.querySelector('h6')?.classList.contains(`text-${col}`)
        );

        const heading = card.querySelector('h6');
        if (heading) {
            heading.textContent = `エージェント${label}`;
            heading.className = `fw-bold text-${newColor} mb-0`;
        }

        if (oldColor && oldColor !== newColor) {
            card.querySelectorAll('textarea').forEach((ta) => {
                ta.classList.replace(`border-${oldColor}`, `border-${newColor}`);
            });
        }
    });
};

const addAgentCard = () => {
    const container = document.getElementById('agentsContainer');
    const existingCols = container.querySelectorAll('.agent-col');
    const idx = existingCols.length;
    if (idx >= 6) {
        alert('エージェントは最大6人まで追加できます。');
        return;
    }

    const label = AGENT_LABELS[idx] || `Agent${idx}`;
    const color = AGENT_COLORS[idx % AGENT_COLORS.length];

    const col = document.createElement('div');
    col.className = 'col-md-6 mb-4 agent-col';
    col.dataset.index = idx;
    col.innerHTML = `
<div class="border rounded p-3 agent-card" data-agent-index="${idx}">
  <div class="d-flex justify-content-between align-items-center mb-3">
    <h6 class="fw-bold text-${color} mb-0">エージェント${esc(label)}</h6>
    <button type="button" class="btn btn-sm btn-outline-danger remove-agent-btn">削除</button>
  </div>
  <div class="mb-2">
    <label class="form-label small fw-semibold">主張</label>
    <textarea class="form-control border-${color} agent-claim" rows="2" placeholder="主張を入力"></textarea>
  </div>
  <div class="mb-2">
    <label class="form-label small fw-semibold">理由</label>
    <textarea class="form-control border-${color} agent-rationale" rows="2" placeholder="理由を入力"></textarea>
  </div>
  <div class="mb-2">
    <label class="form-label small fw-semibold">前提条件</label>
    <textarea class="form-control border-${color} agent-preconditions" rows="2" placeholder="前提条件を入力"></textarea>
  </div>
  <div class="mb-0">
    <label class="form-label small fw-semibold">立場を支える経験・知識</label>
    <textarea class="form-control border-${color} agent-experience" rows="2" placeholder="経験や知識を入力"></textarea>
  </div>
</div>`;
    container.appendChild(col);

    col.querySelector('.remove-agent-btn').addEventListener('click', () => {
        col.remove();
        reindexAgents();
    });
};

/* =============================
   入力収集
============================= */

const collectInput = () => {
    const topic = document.getElementById('topic').value.trim();
    const maxTurns = parseInt(document.getElementById('maxTurns').value, 10) || 2;

    const agentCards = document.querySelectorAll('.agent-card');
    const agents = Array.from(agentCards).map((card, i) => ({
        label: `エージェント${AGENT_LABELS[i] || i}`,
        coreClaim: card.querySelector('.agent-claim')?.value.trim() || '',
        rationale: card.querySelector('.agent-rationale')?.value.trim() || '',
        preconditions: card.querySelector('.agent-preconditions')?.value.trim() || '',
        experience: card.querySelector('.agent-experience')?.value.trim() || '',
    }));

    return { topic, agents, maxTurns };
};

/* =============================
   描画: フェーズ1
============================= */

const renderPhase1 = (phase1) => {
    const container = document.getElementById('phase1Content');
    container.innerHTML = '';

    (phase1 || []).forEach((item, i) => {
        const itemId = `p1_${i}`;
        container.insertAdjacentHTML(
            'beforeend',
            createAccordionItem('phase1Accordion', itemId, item.label, preText(item.text), i === 0)
        );
    });
};

/* =============================
   描画: フェーズ2
============================= */

const renderPhase2 = (phase2) => {
    const container = document.getElementById('phase2Content');
    container.innerHTML = '';

    const researchHtml = (phase2.research || [])
        .map((r) => `<h6 class="fw-semibold">${esc(r.label)}</h6>${preText(r.text)}`)
        .join('<hr>');
    container.insertAdjacentHTML(
        'beforeend',
        createAccordionItem('phase2Accordion', 'p2_research', 'Step1: 情報取得結果', researchHtml)
    );

    container.insertAdjacentHTML(
        'beforeend',
        createAccordionItem('phase2Accordion', 'p2_credibility', 'Step2: 情報信頼性検証', preText(phase2.credibility))
    );

    const rebuttalHtml = (phase2.rebuttals || [])
        .map((r) => `<h6 class="fw-semibold">${esc(r.attacker)} ↔ ${esc(r.defender)}</h6>${preText(r.text)}`)
        .join('<hr>');
    container.insertAdjacentHTML(
        'beforeend',
        createAccordionItem('phase2Accordion', 'p2_rebuttals', 'Step3: 全対全反論', rebuttalHtml)
    );

    const subTopicHtml = (phase2.subTopics || [])
        .map((st) => `<div class="mb-2"><strong>${esc(st.title)}</strong><br><small class="text-muted">${esc(st.reason)}</small></div>`)
        .join('');
    container.insertAdjacentHTML(
        'beforeend',
        createAccordionItem('phase2Accordion', 'p2_subtopics', 'Step4: サブ議題一覧', subTopicHtml)
    );

    const decompositionHtml = Object.entries(phase2.decomposition || {})
        .map(([label, data]) => {
            const points = (data.mainPoints || []).map((p) => `<li>${esc(p)}</li>`).join('');
            const evidence = (data.evidence || []).map((e) => `<li>${esc(e)}</li>`).join('');
            const values = (data.valuePremises || []).map((v) => `<li>${esc(v)}</li>`).join('');
            return `<h6 class="fw-semibold">${esc(label)}</h6>
<p class="mb-1"><strong>主な論点:</strong></p><ul>${points}</ul>
<p class="mb-1"><strong>根拠:</strong></p><ul>${evidence}</ul>
<p class="mb-1"><strong>価値前提:</strong></p><ul>${values}</ul>`;
    }).join('<hr>');
    container.insertAdjacentHTML('beforeend',
        createAccordionItem('phase2Accordion', 'p2_decomp', 'Step5: 要素分解', decompositionHtml)
    );
};

/* =============================
   描画: フェーズ3
============================= */

const renderPhase3 = (phase3) => {
    const container = document.getElementById('phase3Content');
    container.innerHTML = '';

    (phase3 || []).forEach((item, i) => {
        const st = item.subTopic || {};
        const depthBadge = st.depth > 0
            ? `<span class="badge bg-secondary ms-2">depth ${esc(String(st.depth))}</span>`
            : '';

        const innerAccId = `p3_inner_acc_${i}`;
        const turnsHtml = `<div class="accordion" id="${esc(innerAccId)}">${(item.discussionLog || []).map((entry, ti) => {
            const utterancesHtml = (entry.utterances || []).map((u) => `
                    <div class="mb-3">
                        <span class="badge bg-dark me-1">${esc(u.label)}</span>
                        ${preText(u.text)}
                    </div>`
                ).join('');
                const turnTitle = entry.subStep
                    ? `ターン${esc(String(entry.turn))}-${esc(entry.subStep)}`
                    : `ターン${esc(String(entry.turn))} (攻撃モード: ${esc(entry.attackMode || '-')})`;
                return createAccordionItem(
                    innerAccId,
                    `p3_${i}_t${ti}`,
                    turnTitle,
                    utterancesHtml,
                    ti === 0
                );
            }).join('') +
            '</div>';

        const titleText = `${esc(st.title || `サブ議題${i + 1}`)}${depthBadge}`;
        // ボタンのテキストにバッジHTMLを含めたいのでescを使わずinnerHTMLとして挿入
        const itemId = `p3_${i}`;
        const showClass = i === 0 ? 'show' : '';
        const collapsedClass = i === 0 ? '' : 'collapsed';
        const accordionItemHtml = `
<div class="accordion-item">
  <h2 class="accordion-header" id="heading_${esc(itemId)}">
    <button class="accordion-button ${collapsedClass}" type="button"
      data-bs-toggle="collapse"
      data-bs-target="#collapse_${esc(itemId)}"
      aria-expanded="${i === 0}"
      aria-controls="collapse_${esc(itemId)}">
      ${esc(st.title || `サブ議題${i + 1}`)}${depthBadge}
    </button>
  </h2>
  <div id="collapse_${esc(itemId)}"
    class="accordion-collapse collapse ${showClass}"
    aria-labelledby="heading_${esc(itemId)}"
    data-bs-parent="#phase3Accordion">
    <div class="accordion-body">
      ${st.reason ? `<p class="text-muted small mb-3">${esc(st.reason)}</p>` : ''}
      ${turnsHtml}
    </div>
  </div>
</div>`;
        container.insertAdjacentHTML('beforeend', accordionItemHtml);
    });
};

/* =============================
   描画: フェーズ4
============================= */

const renderPhase4 = (phase4) => {
    const container = document.getElementById('phase4Content');
    container.innerHTML = '';

    const synthesis = phase4.synthesis || {};
    const turn1Html = (synthesis.turn1 || [])
        .map((u) => `<div class="mb-3"><span class="badge bg-primary me-1">${esc(u.label)}</span>${preText(u.text)}</div>`)
        .join('');
    const turn2Html = (synthesis.turn2 || [])
        .map((u) => `<div class="mb-3"><span class="badge bg-success me-1">${esc(u.label)}</span>${preText(u.text)}</div>`)
        .join('');
    const turn1AccordionId = 'phase4SynthesisAccordion';

    container.insertAdjacentHTML('beforeend', `
<div class="mb-3">
  <h5 class="fw-semibold">統合表明</h5>
  <div class="accordion" id="${turn1AccordionId}">
    ${createAccordionItem(turn1AccordionId, 'p4_turn1', 'ターン1: 独立統合表明', turn1Html, true)}
    ${createAccordionItem(turn1AccordionId, 'p4_turn2', 'ターン2: 相互参照後の統合表明', turn2Html)}
  </div>
</div>`);

    document.getElementById('summaryContent').textContent = cleanSummary(phase4.finalSummary || '');
};

/* =============================
   描画: 前提検証トラック
============================= */

const renderAssumptionDebateLog = (assumptionDebateLog) => {
    const section = document.getElementById('assumptionTrackSection');
    const container = document.getElementById('assumptionTrackContent');
    if (!section || !container) return;

    if (!assumptionDebateLog || assumptionDebateLog.length === 0) {
        section.classList.add('d-none');
        return;
    }

    section.classList.remove('d-none');
    container.innerHTML = '';

    const accId = 'assumptionTrackAccordion';
    assumptionDebateLog.forEach((entry, i) => {
        const itemId = `at_${i}`;
        const titleShort = entry.content ? entry.content.slice(0, 20) : '';
        const accordionTitle = `${esc(entry.id || String(i))}: ${esc(titleShort)}`;
        const invalidatedLabel = (entry.invalidationScore || 0) >= 0.7 ? '反証成立' : '反証未成立';

        const utterancesHtml = (entry.gammaUtterances || []).map(u =>
            `<div class="mb-2">
                <span class="badge bg-dark me-1">${esc(u.label)}</span>
                ${preText(u.text)}
            </div>`
        ).join('');

        const bodyHtml = `
<p class="mb-1"><strong>反証スコア:</strong> ${esc(String(entry.invalidationScore || 0))}</p>
<p class="mb-2"><strong>判定:</strong> ${esc(invalidatedLabel)}</p>
<h6 class="fw-semibold mt-3">γ攻撃発言</h6>
${utterancesHtml}`;

        container.insertAdjacentHTML('beforeend',
            createAccordionItem(accId, itemId, accordionTitle, bodyHtml, i === 0)
        );
    });
};

/* =============================
   議論開始
============================= */

const startDebate = async () => {
    const { topic, agents, maxTurns } = collectInput();

    if (!topic) {
        alert('議題を入力してください');
        return;
    }

    for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.coreClaim || !a.rationale || !a.preconditions) {
            alert(`エージェント${AGENT_LABELS[i] || i} に必要項目（主張・理由・前提条件）を入力してください`);
            return;
        }
    }

    const btn = document.getElementById('startBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>議論実行中...（数秒かかります）';

    document.getElementById('resultArea').classList.add('d-none');

    try {
        const res = await fetch('/api/debate/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, agents, maxTurns }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'サーバーエラー' }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        renderPhase1(data.phase1);
        renderPhase2(data.phase2);
        renderPhase3(data.phase3);
        renderPhase4(data.phase4);
        renderAssumptionDebateLog(data.assumptionDebateLog);

        document.getElementById('resultArea').classList.remove('d-none');
        document.getElementById('resultArea').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        alert('エラーが発生しました: ' + err.message);
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '議論開始';
    }
};

/* =============================
   イベント登録
============================= */

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('startBtn')?.addEventListener('click', startDebate);
    document.getElementById('addAgentBtn')?.addEventListener('click', addAgentCard);
});
