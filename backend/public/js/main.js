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
            }).join('')}</div>`;
           

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
   描画: マインドマップ
   方式: SVG サイズ直接制御 + container overflow:auto（OS標準スクロールバー）
   ズーム: Ctrl+スクロール（マウス位置中心）
   縮小限: 横スクロールが消えるまで（SVG幅 ≤ コンテナ幅）
   拡大限: デフォルトスケールの2倍
============================= */
/**
 * containerId → { naturalW, naturalH, defaultScale, currentScale,
 *                 minScale, maxScale, applyScale, wheelHandler }
 */
const mindmapState = {};

/**
 * SVG の viewBox から自然サイズを取得
 * viewBox がなければ width/height 属性、それもなければフォールバック値を返す
 */
const getSvgNaturalSize = (svgEl) => {
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
        const p = vb.trim().split(/[\s,]+/);
        const w = parseFloat(p[2]);
        const h = parseFloat(p[3]);
        if (w > 0 && h > 0) return { w, h };
    }
    return {
        w: parseFloat(svgEl.getAttribute('width'))  || 1200,
        h: parseFloat(svgEl.getAttribute('height')) || 800,
    };
};

/**
 * SVG を指定スケールで描画するユーティリティ
 * @param {SVGElement} svgEl
 * @param {number}     naturalW
 * @param {number}     naturalH
 * @param {number}     scale
 */
const applySvgScale = (svgEl, naturalW, naturalH, scale) => {
    svgEl.setAttribute('width',  Math.round(naturalW * scale));
    svgEl.setAttribute('height', Math.round(naturalH * scale));
};

/**
 * SVG データを PNG（2倍解像度）または SVG でダウンロードするユーティリティ
 * @param {SVGElement} svgEl
 * @param {number}     width    - エクスポート幅（px）
 * @param {number}     height   - エクスポート高さ（px）
 * @param {string}     filename - 拡張子なしファイル名
 */
const exportSvgAsPng = (svgEl, width, height, filename) => {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('width',  width);
    clone.setAttribute('height', height);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', 'white');
    clone.insertBefore(bg, clone.firstChild);

    const svgData = new XMLSerializer().serializeToString(clone);
    const bytes   = new TextEncoder().encode(svgData);
    const binary  = bytes.reduce((acc, b) => acc + String.fromCharCode(b), '');
    const imgSrc  = 'data:image/svg+xml;base64,' + btoa(binary);

    const scale  = 2;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(width  * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);

    const downloadBlob = (blob) => {
        const a = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    };
    const fallbackSvg = () => {
        downloadBlob(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }));
    };

    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => blob ? downloadBlob(blob) : fallbackSvg(), 'image/png');
    };
    img.onerror = fallbackSvg;
    img.src = imgSrc;
};

/**
 * マインドマップを指定コンテナに描画する汎用関数
 * @param {string} containerId  - マインドマップ表示先 div の id
 * @param {string} dlBtnId      - ダウンロードボタンの id
 * @param {string} diagramCode  - mermaid コード
 */
const renderMindmap = async (containerId, dlBtnId, diagramCode) => {
    const container = document.getElementById(containerId);
    const card  = container.closest('.card');
    const dlBtn = document.getElementById(dlBtnId);

    if (!diagramCode) {
        card.classList.add('d-none');
        dlBtn.classList.add('d-none');
        return;
    }

    // 既存状態のクリーンアップ
    const prev = mindmapState[containerId];
    if (prev) {
        container.removeEventListener('wheel', prev.wheelHandler);
        delete mindmapState[containerId];
    }
    container.innerHTML = '';

    // Mermaid レンダリング
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
    let svg;
    try {
        ({ svg } = await mermaid.render('mm_' + containerId + '_' + Date.now(), diagramCode));
    } catch (err) {
        console.error('[Mermaid render error]', err, '\n--- diagramCode ---\n', diagramCode);
        container.innerHTML = `<p class="text-danger p-3">マインドマップの描画に失敗しました。コンソールを確認してください。</p>`;
        return;
    }

    container.innerHTML = svg;
    const svgEl = container.querySelector('svg');
    if (!svgEl) { dlBtn.classList.remove('d-none'); return; }

    svgEl.style.maxWidth = 'none';
    svgEl.style.display  = 'block';

    const { w: naturalW, h: naturalH } = getSvgNaturalSize(svgEl);
    const containerH = container.clientHeight || 600;
    const containerW = container.clientWidth  || 800;

    // スケール計算
    // ・defaultScale: 高さがコンテナ縦幅にぴったり収まる（縦スクロールなし）
    // ・minScale    : 幅がコンテナ横幅に収まる（横スクロールなし）
    // ・maxScale    : default の 2 倍
    const defaultScale = containerH / naturalH;
    const minScale     = containerW / naturalW;
    const maxScale     = defaultScale * 2;

    let currentScale = defaultScale;

    const applyScale = (scale) => {
        currentScale = Math.max(minScale, Math.min(maxScale, scale));
        applySvgScale(svgEl, naturalW, naturalH, currentScale);
    };

    applyScale(defaultScale);

    // Ctrl+スクロール: マウス位置を中心にズーム
    const wheelHandler = (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();

        const oldScale = currentScale;
        const factor   = e.deltaY > 0 ? 1 / 1.03 : 1.03;
        const newScale = Math.max(minScale, Math.min(maxScale, oldScale * factor));
        if (newScale === oldScale) return;

        // マウス位置（コンテナ内座標）を求め、ズーム後も同じ点を維持
        const rect   = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + container.scrollLeft;
        const mouseY = e.clientY - rect.top  + container.scrollTop;

        currentScale = newScale;
        applySvgScale(svgEl, naturalW, naturalH, newScale);

        const ratio = newScale / oldScale;
        container.scrollLeft = mouseX * ratio - (e.clientX - rect.left);
        container.scrollTop  = mouseY * ratio - (e.clientY - rect.top);
    };

    container.addEventListener('wheel', wheelHandler, { passive: false });

    mindmapState[containerId] = {
        naturalW, naturalH,
        defaultScale, minScale, maxScale,
        getScale:   () => currentScale,
        applyScale,
        wheelHandler,
    };

    dlBtn.classList.remove('d-none');
};

/**
 * 指定コンテナのマインドマップを PNG でダウンロードする汎用関数
 * ダウンロード時は自然サイズ（2倍解像度）で出力
 * @param {string} containerId - マインドマップ表示先 div の id
 * @param {string} filename    - ダウンロードファイル名（拡張子なし）
 */
const downloadMindmap = (containerId, filename) => {
    const svgEl = document.querySelector(`#${containerId} svg`);
    if (!svgEl) return;

    const state = mindmapState[containerId];
    const { w, h } = getSvgNaturalSize(svgEl);

    // ダウンロードは自然サイズ（全体が見える）で出力
    exportSvgAsPng(svgEl, w, h, `${filename}.png`);
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
            body: JSON.stringify({ topic, agents, maxTurns, roomId: window.roomId }),
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

        // resultArea を先に表示してからマインドマップを描画
        // （コンテナに実寸が付いた状態で mermaid を初期化するため）
        document.getElementById('resultArea').classList.remove('d-none');
        document.getElementById('resultArea').scrollIntoView({ behavior: 'smooth' });
        await renderMindmap('mindmapContent', 'downloadMindmapBtn', data.mindmap1);
        await renderMindmap('mindmapContent2', 'downloadMindmap2Btn', data.mindmap2);
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
    document.getElementById('downloadMindmapBtn')?.addEventListener('click', () =>
        downloadMindmap('mindmapContent', 'mindmap1')
    );
    document.getElementById('downloadMindmap2Btn')?.addEventListener('click', () =>
        downloadMindmap('mindmapContent2', 'mindmap2')
    );
});