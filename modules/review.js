'use strict';
// ══════════════════════════════════════════════
// modules/review.js — QA check, Review search, Consistency, Export
// ══════════════════════════════════════════════
// ─── QA Check ───
async function runQACheck() {
  const source = document.getElementById('sourceText').value.trim();
  const translation = document.getElementById('translationOutput').innerText.trim();
  if (!source || !translation || translation === 'คำแปลจะปรากฏที่นี่...') {
    showToast('ต้องมีทั้งต้นฉบับและคำแปลก่อน', 'error'); return;
  }
  showToast('กำลังตรวจ QA...', '');
  try {
    const glossaryStr = buildGlossaryStr(getOptions().wsGlossary);
    const prompt = QA_PROMPT
      .replace('{glossary}', glossaryStr)
      .replace('{source}', source)
      .replace('{translation}', translation);
    const res = await callOpenRouter({ model: getModelForTask('qa', S.currentWs), messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1000 });
    const txt = res.choices?.[0]?.message?.content?.trim() || '{}';
    const r = JSON.parse(txt.replace(/```json|```/g, '').trim());
    const msg = r.pass ? `✓ PASS (${r.score}/100): ${r.summary}` : `✗ FAIL (${r.score}/100): ${r.summary}`;
    showToast(msg, r.pass ? 'success' : 'error');
  } catch (e) { showToast('QA ล้มเหลว: ' + e.message, 'error'); }
}

// ─── Glossary Detection ───
function detectGlossary() {
  const text = document.getElementById('sourceText').value.trim();
  if (!text) { showToast('ใส่ข้อความก่อน', 'error'); return; }
  const glossary = S.currentWs?.glossary || [];
  if (!glossary.length) { showToast('ยังไม่มีคลังศัพท์', ''); return; }

  let highlighted = esc(text);
  let matchCount = 0;
  glossary.forEach(g => {
    const escaped = g.korean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    if (regex.test(highlighted)) {
      matchCount++;
      highlighted = highlighted.replace(new RegExp(escaped, 'g'), `<mark class="glossary-term" title="${esc(g.thai)}">${esc(g.korean)}</mark>`);
    }
  });

  if (!matchCount) { showToast('ไม่พบคำศัพท์ในคลัง', ''); return; }
  const hl = document.getElementById('sourceHighlight');
  hl.innerHTML = highlighted;
  hl.style.display = 'block';
  document.getElementById('sourceText').style.display = 'none';
  showToast(`พบ ${matchCount} คำศัพท์ (แตะเพื่อซ่อน)`, 'success');
}

function hideHighlight() {
  document.getElementById('sourceHighlight').style.display = 'none';
  document.getElementById('sourceText').style.display = 'block';
}

// ─── API Key Settings ───
function saveApiKey() {
  const key = document.getElementById('settingsApiKey').value.trim();
  if (!key) return;
  localStorage.setItem(LS_KEY_API, key);
  closeModal('modal-settings');
  checkHealth();
  showToast('บันทึก API Key แล้ว ✓', 'success');
}

async function testApiKey() {
  const key = document.getElementById('settingsApiKey').value.trim();
  const result = document.getElementById('apiTestResult');
  if (!key) { result.textContent = '⚠ ใส่ key ก่อน'; result.style.color = 'var(--gold)'; return; }
  result.textContent = 'กำลังทดสอบ...'; result.style.color = 'var(--text-muted)';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
    if (res.ok) { result.textContent = '✓ Key ใช้งานได้'; result.style.color = '#4caf50'; }
    else { result.textContent = '✗ Key ไม่ถูกต้อง'; result.style.color = 'var(--crimson-light)'; }
  } catch { result.textContent = '✗ ทดสอบไม่สำเร็จ'; result.style.color = 'var(--crimson-light)'; }
}

// ─── Cost Tracker ───
function resetCosts() {
  S.costs = { tokens: { total:0, input:0, output:0 }, costUSD:0, costTHB:0 };
  localStorage.setItem(LS_KEY_COSTS, JSON.stringify(S.costs));
  updateCostUI();
  showToast('รีเซ็ตต้นทุนแล้ว', '');
}

// ─── Progress UI ───
function showProgress(show) {
  document.getElementById('progressContainer').style.display = show ? 'block' : 'none';
  if (show) { ['glossary','translate','polish','done'].forEach(s => setStage(s,'')); updateProgress(0,'กำลังเริ่ม...'); }
}
function updateProgress(pct, label) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  if (label) document.getElementById('progressLabel').textContent = label;
}
function setStage(stage, status) {
  const el = document.getElementById(`stage-${stage}`);
  if (el) el.className = 'stage' + (status ? ' ' + status : '');
}

// ─── Auto Glossary ───
let _agTerms = [];
let _agTab = 'manual';

function agSwitchTab(tab) {
  _agTab = tab;
  document.getElementById('agPanelManual').style.display = tab === 'manual' ? 'block' : 'none';
  document.getElementById('agPanelChapters').style.display = tab === 'chapters' ? 'block' : 'none';
  const btnManual = document.getElementById('agTabManual');
  const btnChapters = document.getElementById('agTabChapters');
  btnManual.style.borderBottom = tab === 'manual' ? '2px solid var(--gold)' : 'none';
  btnManual.style.color = tab === 'manual' ? 'var(--gold)' : '';
  btnManual.className = tab === 'manual' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
  btnChapters.style.borderBottom = tab === 'chapters' ? '2px solid var(--gold)' : 'none';
  btnChapters.style.color = tab === 'chapters' ? 'var(--gold)' : '';
  btnChapters.className = tab === 'chapters' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
}

function agRenderChapterList() {
  const list = document.getElementById('agChapterList');
  const chapters = [...(S.currentWs?.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (!chapters.length) { list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:6px">ยังไม่มีตอน</div>'; return; }
  list.innerHTML = chapters.map(ch => `
    <label class="ag-ch-row" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer">
      <input type="checkbox" class="ag-ch-chk" data-id="${ch.id}" style="accent-color:var(--gold)" onchange="agUpdateChaptersInfo()"/>
      <span style="font-size:0.78rem;color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
      <span style="font-size:0.82rem;color:var(--text-primary);flex:1">${esc(ch.title)}</span>
      <span style="font-size:0.68rem;color:var(--text-muted)">${ch.sourceText ? ch.sourceText.length.toLocaleString()+' ตัวอักษร' : 'ไม่มีต้นฉบับ'}</span>
    </label>
  `).join('');
}

function agUpdateChaptersInfo() {
  const checked = document.querySelectorAll('.ag-ch-chk:checked');
  const total = [...checked].reduce((s, el) => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    return s + (ch?.sourceText?.length || 0);
  }, 0);
  document.getElementById('agChaptersInfo').textContent = checked.length ? `เลือก ${checked.length} ตอน · ${total.toLocaleString()} ตัวอักษรรวม` : '';
}

function agSelectAllChapters() {
  document.querySelectorAll('.ag-ch-chk').forEach(el => el.checked = true);
  agUpdateChaptersInfo();
}
function agDeselectAllChapters() {
  document.querySelectorAll('.ag-ch-chk').forEach(el => el.checked = false);
  agUpdateChaptersInfo();
}

function openAutoGlossary() {
  const src = document.getElementById('sourceText')?.value?.trim() || '';
  document.getElementById('agSourceText').value = src;
  document.getElementById('agResults').style.display = 'none';
  document.getElementById('agStatus').textContent = '';
  _agTerms = [];
  _agTab = 'manual';
  agSwitchTab('manual');
  agRenderChapterList();
  openModal('modal-autoglossary');
}



function renderAgResults(terms) {
  const list = document.getElementById('agResultList');
  list.innerHTML = terms.map((t, i) => `
    <div class="ag-item selected" id="ag-item-${i}" onclick="toggleAgItem(${i})">
      <input class="ag-check" type="checkbox" id="ag-chk-${i}" checked onclick="event.stopPropagation();syncAgItem(${i})"/>
      <span class="ag-korean">${esc(t.korean)}</span>
      <span class="ag-arrow">→</span>
      <input class="ag-thai-input" id="ag-thai-${i}" value="${esc(t.thai)}" onclick="event.stopPropagation()" title="แก้ไขคำแปล"/>
      <span class="ag-type-badge"><span class="tag tag-${t.type || 'term'}">${t.type || 'term'}</span></span>
      <span class="ag-note">${esc(t.note || '')}</span>
    </div>
  `).join('');
}

function toggleAgItem(i) {
  const chk = document.getElementById(`ag-chk-${i}`);
  const item = document.getElementById(`ag-item-${i}`);
  chk.checked = !chk.checked;
  item.classList.toggle('selected', chk.checked);
}
function syncAgItem(i) {
  const chk = document.getElementById(`ag-chk-${i}`);
  document.getElementById(`ag-item-${i}`).classList.toggle('selected', chk.checked);
}
function selectAllAg() { _agTerms.forEach((_, i) => { document.getElementById(`ag-chk-${i}`).checked = true; document.getElementById(`ag-item-${i}`).classList.add('selected'); }); }
function deselectAllAg() { _agTerms.forEach((_, i) => { document.getElementById(`ag-chk-${i}`).checked = false; document.getElementById(`ag-item-${i}`).classList.remove('selected'); }); }



// ─── Find & Replace (v2) ───
let _frMatches = [];
let _frMatchIdx = -1;
let _frHighlightNodes = [];
let _frHistory = (() => { try { return JSON.parse(sessionStorage.getItem('fr_history') || '[]'); } catch { return []; } })();

// ─── Translation Context Memory ───
const CTX_SUMMARY_PROMPT = `วิเคราะห์และสรุปบทนี้สำหรับใช้เป็น context ในการแปลตอนถัดไป โดยระบุ:
1. ตัวละครที่ปรากฏ: ชื่อ, เพศ, สรรพนามที่ใช้แทนตัว (ผม/ฉัน/เรา/กู ฯลฯ)
2. เหตุการณ์สำคัญ (2-3 ประโยค)
3. อารมณ์/บรรยากาศท้ายตอน

ตอบเป็นภาษาไทย กระชับ ไม่เกิน 120 คำ`;

const CTX_COMPRESS_PROMPT = `รวม context summaries เหล่านี้ให้เป็น summary เดียว ไม่เกิน 180 คำ คงไว้ซึ่งชื่อตัวละคร เพศ สรรพนาม และเหตุการณ์สำคัญที่ยังส่งผลต่อเรื่อง:`;

function wsGetContext(ws) {
  if (!ws) return null;
  if (!ws.translationContext) {
    ws.translationContext = { enabled: false, maxTokens: 1500, summaries: [] };
  }
  return ws.translationContext;
}

function ctxEstimateTokens(text) {
  return Math.ceil((text || '').length / 3); // Thai ~3 chars/token
}

function ctxGetTotalTokens(ws) {
  const ctx = wsGetContext(ws);
  return ctx ? ctx.summaries.reduce((s, x) => s + (x.tokens || 0), 0) : 0;
}

function ctxGetPromptText(ws) {
  const ctx = wsGetContext(ws);
  if (!ctx || !ctx.enabled || !ctx.summaries.length) return '';
  const parts = ctx.summaries.map(s => {
    const label = s.compressed ? `📚 ${s.title}` : `ตอน ${s.chapterNum}${s.title ? ': ' + s.title : ''}`;
    return `[${label}]\n${s.text}`;
  });
  return `### บริบทเรื่องที่ผ่านมา (ใช้เพื่อความสอดคล้องในการแปล — ห้ามแปลส่วนนี้)\n${parts.join('\n\n')}`;
}

async function ctxAddSummary(ws, chId, chapterNum, title, translatedText) {
  const ctx = wsGetContext(ws);
  if (!ctx || !ctx.enabled || !translatedText?.trim()) return;

  const summary = await ctxGenerateSummary(translatedText, ws);
  if (!summary) return;

  // Remove old entry for same chapter
  ctx.summaries = ctx.summaries.filter(s => s.chId !== chId);
  ctx.summaries.push({
    chId, chapterNum: chapterNum || 0, title: title || '',
    text: summary, tokens: ctxEstimateTokens(summary),
    compressed: false, createdAt: Date.now()
  });
  ctx.summaries.sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));

  await ctxMaybeCompress(ws);
  await lsSaveWorkspace(ws);
  ctxUpdateStatusBadge(ws);

  // Refresh modal if open
  if (document.getElementById('modal-ctx-manager')?.style.display !== 'none') ctxRenderSummaries();
}

async function ctxGenerateSummary(translatedText, ws) {
  const ctx = wsGetContext(ws);
  try {
    const res = await callOpenRouter({
      model: getModelForTask('summary', ws),
      messages: [{ role: 'user', content: `${CTX_SUMMARY_PROMPT}\n\n---\n${translatedText.slice(0, 4000)}` }],
      temperature: 0.3, max_tokens: 350,
    });
    return res.choices?.[0]?.message?.content?.trim() || null;
  } catch(e) {
    console.warn('[CTX] summary failed:', e);
    return null;
  }
}

async function ctxMaybeCompress(ws) {
  const ctx = wsGetContext(ws);
  if (!ctx) return;
  const total = ctxGetTotalTokens(ws);
  if (total <= ctx.maxTokens) return;
  if (ctx.summaries.length <= 2) { ctx.summaries.shift(); return; }

  const toCompress = ctx.summaries.slice(0, -2);
  const toKeep     = ctx.summaries.slice(-2);
  const combined   = toCompress.map(s => `[${s.compressed ? s.title : 'ตอน ' + s.chapterNum}]:\n${s.text}`).join('\n\n');

  try {
    const res = await callOpenRouter({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: `${CTX_COMPRESS_PROMPT}\n\n${combined}` }],
      temperature: 0.3, max_tokens: 500,
    });
    const compressed = res.choices?.[0]?.message?.content?.trim();
    if (compressed) {
      const first = toCompress[0], last = toCompress[toCompress.length - 1];
      ctx.summaries = [{
        chId: `compressed_${Date.now()}`,
        chapterNum: first.chapterNum,
        title: `สรุปรวม ตอน ${first.chapterNum}–${last.chapterNum}`,
        text: compressed, tokens: ctxEstimateTokens(compressed),
        compressed: true, createdAt: Date.now()
      }, ...toKeep];
      showToast('🧠 Context compressed อัตโนมัติ', 'info', 2500);
    }
  } catch(e) {
    console.warn('[CTX] compress failed:', e);
    ctx.summaries.shift(); // fallback: drop oldest
  }
}

// ── Context Manager UI ──
function openContextManager() {
  const ws = S.currentWs;
  if (!ws) { showToast('เปิด Workspace ก่อน', 'error'); return; }
  ctxRenderSummaries();
  openModal('modal-ctx-manager');
}

function ctxRenderSummaries() {
  const ws  = S.currentWs;
  const ctx = wsGetContext(ws);
  const list    = document.getElementById('ctxSummaryList');
  const totalEl = document.getElementById('ctxTokenTotal');
  const barEl   = document.getElementById('ctxTokenBar');
  if (!ctx || !list) return;

  const total = ctxGetTotalTokens(ws);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  if (totalEl) totalEl.textContent = `${total} / ${ctx.maxTokens} tokens (${pct}%)`;
  if (barEl) {
    barEl.style.width = pct + '%';
    barEl.style.background = pct > 85 ? 'var(--crimson)' : pct > 60 ? 'var(--gold)' : 'var(--accent)';
  }

  if (!ctx.summaries.length) {
    list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:28px;font-size:0.83rem">
      ยังไม่มี context summary<br>
      <span style="font-size:0.75rem">จะถูกสร้างอัตโนมัติหลังแปลแต่ละตอน (เมื่อเปิดใช้งาน)</span>
    </div>`;
    return;
  }

  list.innerHTML = ctx.summaries.map((s, idx) => `
    <div style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:0.78rem;font-weight:600;color:var(--text-primary)">
          ${s.compressed ? '📚 ' + s.title : '📄 ตอน ' + s.chapterNum + (s.title ? ': ' + s.title : '')}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:0.68rem;color:var(--text-muted)">${s.tokens || 0} tokens</span>
          <button class="btn-xs" onclick="ctxDeleteSummary(${idx})" style="color:var(--crimson-light)" title="ลบ">🗑</button>
        </div>
      </div>
      <textarea
        style="width:100%;box-sizing:border-box;background:var(--bg-deep);border:1px solid var(--border);
               border-radius:4px;padding:6px 8px;font-size:0.78rem;line-height:1.7;color:var(--text-secondary);
               resize:vertical;min-height:70px;font-family:inherit"
        onchange="ctxUpdateSummary(${idx}, this.value)">${escHtml(s.text)}</textarea>
    </div>
  `).join('');
}

function ctxUpdateSummary(idx, newText) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx?.summaries[idx]) return;
  ctx.summaries[idx].text   = newText;
  ctx.summaries[idx].tokens = ctxEstimateTokens(newText);
  // Refresh token bar only
  const total = ctxGetTotalTokens(S.currentWs);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  const totalEl = document.getElementById('ctxTokenTotal');
  const barEl   = document.getElementById('ctxTokenBar');
  if (totalEl) totalEl.textContent = `${total} / ${ctx.maxTokens} tokens (${pct}%)`;
  if (barEl) barEl.style.width = pct + '%';
}

function ctxDeleteSummary(idx) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.summaries.splice(idx, 1);
  ctxRenderSummaries();
}

async function ctxSaveAndClose() {
  await lsSaveWorkspace(S.currentWs);
  ctxUpdateStatusBadge(S.currentWs);
  showToast('บันทึก context แล้ว ✓', 'success');
  closeModal('modal-ctx-manager');
}

async function ctxResetAll() {
  if (!confirm('ล้าง context ทั้งหมดใช่ไหม?')) return;
  const ctx = wsGetContext(S.currentWs);
  if (ctx) ctx.summaries = [];
  await lsSaveWorkspace(S.currentWs);
  ctxUpdateStatusBadge(S.currentWs);
  ctxRenderSummaries();
  showToast('ล้าง context แล้ว', 'info');
}

function ctxToggleEnabled(enabled) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.enabled = enabled;
  document.getElementById('wsCtxOptions').style.display = enabled ? 'block' : 'none';
  ctxUpdateStatusBadge(S.currentWs);
  lsSaveWorkspace(S.currentWs);
}

function ctxSetMaxTokens(val) {
  const ctx = wsGetContext(S.currentWs);
  if (!ctx) return;
  ctx.maxTokens = parseInt(val) || 1500;
  ctxUpdateStatusBadge(S.currentWs);
  lsSaveWorkspace(S.currentWs);
}

function ctxUpdateStatusBadge(ws) {
  const ctx = wsGetContext(ws);
  const el  = document.getElementById('wsCtxStatus');
  if (!el || !ctx) return;
  const n     = ctx.summaries.length;
  const total = ctxGetTotalTokens(ws);
  const pct   = Math.min(100, Math.round((total / (ctx.maxTokens || 1500)) * 100));
  el.textContent = n ? `${n} summary · ${total} tokens (${pct}%)` : 'ยังไม่มี summary';
  el.style.color = pct > 85 ? 'var(--crimson-light)' : pct > 60 ? 'var(--gold)' : 'var(--text-muted)';
}

// ─── Review Search state ───
let _rsMatches = [];
let _rsMatchIdx = -1;
let _rsCurrentTexts = {};   // { chId: liveText }
let _rsPendingChanges = {}; // { chId: newText } — accumulated, saved on close
let _rsBStartFull = 0;      // actual index in full text where context slice starts
let _rsAEndFull   = 0;      // actual index in full text where context slice ends
let _rsEditMode   = false;  // true = free-edit textarea mode

function openFindReplace() {
  document.getElementById('frFind').value = '';
  document.getElementById('frReplace').value = '';
  document.getElementById('frMatchInfo').textContent = 'พิมพ์เพื่อค้นหา';
  document.getElementById('frMatchInfo').style.color = 'var(--text-muted)';
  document.getElementById('frWsResults').style.display = 'none';
  _frMatches = []; _frMatchIdx = -1;
  frRenderHistory();
  openModal('modal-findreplace');
  setTimeout(() => document.getElementById('frFind').focus(), 150);
}

function getFROptions() {
  return {
    caseSensitive: document.getElementById('frCaseSensitive').checked,
    wholeWord: document.getElementById('frWholeWord').checked,
    regex: document.getElementById('frRegex').checked,
  };
}

function buildFRRegex(term, opts, flags) {
  let p = opts.regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord && !opts.regex) p = `\\b${p}\\b`;
  const f = (flags !== undefined ? flags : '') + (opts.caseSensitive ? '' : 'i');
  return new RegExp(p, f);
}

function frKeyDown(e) {
  if (e.key === 'Enter') { e.shiftKey ? frNavPrev() : frNavNext(); }
}

function frLiveSearch() {
  const term = document.getElementById('frFind').value;
  const scope = document.getElementById('frScope').value;
  _frMatches = []; _frMatchIdx = -1;

  if (!term) {
    document.getElementById('frMatchInfo').textContent = 'พิมพ์เพื่อค้นหา';
    document.getElementById('frMatchInfo').style.color = 'var(--text-muted)';
    document.getElementById('frWsResults').style.display = 'none';
    return;
  }

  const opts = getFROptions();
  try {
    if (scope === 'current') {
      const text = document.getElementById('translationOutput').innerText || '';
      const regex = buildFRRegex(term, opts, 'g');
      const matches = [...text.matchAll(regex)];
      _frMatches = matches.map(m => ({ chId: null, chTitle: null, index: m.index, match: m[0] }));
      const info = document.getElementById('frMatchInfo');
      if (matches.length) {
        info.textContent = `พบ ${matches.length} รายการ`;
        info.style.color = 'var(--gold)';
        _frMatchIdx = 0;
        frHighlightInOutput(term, opts);
      } else {
        info.textContent = 'ไม่พบคำนี้';
        info.style.color = 'var(--crimson-light)';
      }
      document.getElementById('frWsResults').style.display = 'none';
    } else {
      // workspace scan
      const chapters = S.currentWs?.chapters || [];
      const wsDiv = document.getElementById('frWsResults');
      let totalHits = 0;
      let html = '';
      chapters.forEach(ch => {
        if (!ch.translation) return;
        const regex = buildFRRegex(term, opts, 'g');
        const hits = [...ch.translation.matchAll(regex)];
        if (!hits.length) return;
        totalHits += hits.length;
        const preview = ch.translation.slice(Math.max(0, hits[0].index - 30), hits[0].index + 60).replace(/\n/g,' ');
        html += `<div style="padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--gold);font-size:0.72rem">#${ch.chapterNum||'?'} ${esc(ch.title)}</span> <span style="color:var(--text-muted)">— ${hits.length} รายการ</span><div style="color:var(--text-secondary);font-size:0.72rem;margin-top:1px">...${esc(preview)}...</div></div>`;
      });
      const info = document.getElementById('frMatchInfo');
      if (totalHits) {
        info.textContent = `พบ ${totalHits} รายการใน Workspace`;
        info.style.color = 'var(--gold)';
        wsDiv.innerHTML = html || '<div style="color:var(--text-muted);padding:4px">ไม่พบในตอนไหน</div>';
        wsDiv.style.display = 'block';
      } else {
        info.textContent = 'ไม่พบในทุกตอน';
        info.style.color = 'var(--crimson-light)';
        wsDiv.style.display = 'none';
      }
    }
  } catch(e) {
    document.getElementById('frMatchInfo').textContent = 'Regex ไม่ถูกต้อง';
    document.getElementById('frMatchInfo').style.color = 'var(--crimson-light)';
  }
}

function frHighlightInOutput(term, opts) {
  // visual highlight via mark tags (only for current scope)
  const output = document.getElementById('translationOutput');
  // Remove old highlights and release references immediately
  output.querySelectorAll('mark.fr-hl').forEach(m => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  _frHighlightNodes = [];
  if (!term) return;
  try {
    const regex = buildFRRegex(term, opts, 'g');
    const walk = (node) => {
      if (node.nodeType === 3) {
        const parts = node.textContent.split(regex);
        if (parts.length <= 1) return;
        const frag = document.createDocumentFragment();
        let lastIdx = 0;
        const matches = [...node.textContent.matchAll(regex)];
        matches.forEach((m, i) => {
          frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx, m.index)));
          const mark = document.createElement('mark');
          mark.className = 'fr-hl';
          mark.textContent = m[0];
          mark.style.background = 'rgba(201,168,76,0.35)';
          mark.style.color = 'var(--gold-light)';
          mark.style.borderRadius = '2px';
          frag.appendChild(mark);
          lastIdx = m.index + m[0].length;
        });
        frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx)));
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === 1 && !['mark'].includes(node.tagName.toLowerCase())) {
        [...node.childNodes].forEach(walk);
      }
    };
    [...output.childNodes].forEach(walk);
    // Scroll to first match
    const firstMark = output.querySelector('mark.fr-hl');
    if (firstMark) firstMark.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    _frHighlightNodes = [...output.querySelectorAll('mark.fr-hl')];
    frUpdateActiveHighlight();
  } catch {}
}

function frUpdateActiveHighlight() {
  _frHighlightNodes.forEach((m, i) => {
    m.style.background = i === _frMatchIdx ? 'rgba(201,168,76,0.7)' : 'rgba(201,168,76,0.3)';
    m.style.outline = i === _frMatchIdx ? '2px solid var(--gold)' : 'none';
  });
  if (_frHighlightNodes[_frMatchIdx]) {
    _frHighlightNodes[_frMatchIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const info = document.getElementById('frMatchInfo');
  if (_frHighlightNodes.length) {
    info.textContent = `${_frMatchIdx + 1} / ${_frHighlightNodes.length} รายการ`;
    info.style.color = 'var(--gold)';
  }
}

function frNavNext() {
  if (!_frHighlightNodes.length) { frLiveSearch(); return; }
  _frMatchIdx = (_frMatchIdx + 1) % _frHighlightNodes.length;
  frUpdateActiveHighlight();
}
function frNavPrev() {
  if (!_frHighlightNodes.length) return;
  _frMatchIdx = (_frMatchIdx - 1 + _frHighlightNodes.length) % _frHighlightNodes.length;
  frUpdateActiveHighlight();
}

function frFindAll() {
  frLiveSearch();
}

async function frReplaceAll() {
  const find = document.getElementById('frFind').value;
  const replace = document.getElementById('frReplace').value;
  const info = document.getElementById('frMatchInfo');
  if (!find) { info.textContent = 'ใส่คำค้นหาก่อน'; return; }
  const opts = getFROptions();
  const scope = document.getElementById('frScope').value;

  frPushHistory(find, replace);

  try {
    const regex = buildFRRegex(find, opts, 'g');
    if (scope === 'current') {
      const output = document.getElementById('translationOutput');
      // remove highlights first
      output.querySelectorAll('mark.fr-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
      const segments = output.querySelectorAll('.segment-text');
      let total = 0;
      if (segments.length > 0) {
        segments.forEach(seg => {
          const orig = seg.textContent;
          const hits = orig.match(buildFRRegex(find, opts, 'g'));
          if (hits) { seg.textContent = orig.replace(regex, replace); total += hits.length; }
        });
      } else {
        const orig = output.innerText;
        const hits = orig.match(regex);
        total = hits ? hits.length : 0;
        if (total) output.textContent = orig.replace(regex, replace);
      }
      info.textContent = total ? `แทนที่ ${total} รายการแล้ว ✓` : 'ไม่พบ';
      info.style.color = total ? '#4caf50' : 'var(--crimson-light)';
      _frMatches = []; _frHighlightNodes = []; _frMatchIdx = -1;
    } else {
      // workspace-wide replace
      let total = 0;
      (S.currentWs?.chapters || []).forEach(ch => {
        if (!ch.translation) return;
        const hits = ch.translation.match(buildFRRegex(find, opts, 'g'));
        if (hits) { ch.translation = ch.translation.replace(regex, replace); total += hits.length; }
      });
      if (total) await lsSaveWorkspace(S.currentWs);
      info.textContent = total ? `แทนที่ ${total} รายการในทุกตอนแล้ว ✓` : 'ไม่พบ';
      info.style.color = total ? '#4caf50' : 'var(--crimson-light)';
    }
  } catch(e) { info.textContent = 'Regex ไม่ถูกต้อง'; info.style.color = 'var(--crimson-light)'; }
}

function frReplaceCurrent() {
  const find = document.getElementById('frFind').value;
  const replace = document.getElementById('frReplace').value;
  const info = document.getElementById('frMatchInfo');
  if (!find) return;
  const opts = getFROptions();
  frPushHistory(find, replace);

  try {
    const output = document.getElementById('translationOutput');
    // replace only current highlighted match
    if (_frHighlightNodes[_frMatchIdx]) {
      _frHighlightNodes[_frMatchIdx].replaceWith(document.createTextNode(replace));
      _frHighlightNodes.splice(_frMatchIdx, 1);
      if (_frMatchIdx >= _frHighlightNodes.length) _frMatchIdx = Math.max(0, _frHighlightNodes.length - 1);
      frUpdateActiveHighlight();
      info.textContent = `แทนที่แล้ว · เหลือ ${_frHighlightNodes.length} รายการ`;
      info.style.color = '#4caf50';
    } else {
      // fallback: replace first occurrence
      output.querySelectorAll('mark.fr-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
      const text = output.innerText;
      const regex = buildFRRegex(find, opts);
      const replaced = text.replace(regex, replace);
      if (replaced !== text) { output.textContent = replaced; info.textContent = 'แทนที่ 1 รายการแล้ว'; info.style.color = '#4caf50'; }
      else { info.textContent = 'ไม่พบ'; info.style.color = 'var(--crimson-light)'; }
    }
  } catch(e) { info.textContent = 'Regex ไม่ถูกต้อง'; info.style.color = 'var(--crimson-light)'; }
}

function frPushHistory(find, replace) {
  if (!find) return;
  const entry = { find, replace };
  _frHistory = [entry, ..._frHistory.filter(h => h.find !== find || h.replace !== replace)].slice(0, 8);
  sessionStorage.setItem('fr_history', JSON.stringify(_frHistory));
  frRenderHistory();
}

function frRenderHistory() {
  const wrap = document.getElementById('frHistoryWrap');
  if (!wrap) return;
  wrap.innerHTML = _frHistory.slice(0, 5).map((h, i) => `
    <span class="btn-xs" onclick="frApplyHistory(${i})" title="${esc(h.find)} → ${esc(h.replace)}" style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.find)}</span>
  `).join('');
}

function frApplyHistory(i) {
  const h = _frHistory[i];
  if (!h) return;
  document.getElementById('frFind').value = h.find;
  document.getElementById('frReplace').value = h.replace;
  frLiveSearch();
}

// ─── Review Search ───
function openReviewSearch(prefill) {
  _rsMatches = [];
  _rsMatchIdx = -1;
  _rsCurrentTexts = {};
  _rsPendingChanges = {};

  const findEl = document.getElementById('rsFind');
  const repEl  = document.getElementById('rsReplaceInput');
  findEl.value = prefill || '';
  repEl.value  = '';

  _rsEditMode = false;
  ['rsProgressBar','rsContextWrap'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('rsReplaceWrap').style.display = 'none';
  document.getElementById('rsEndMsg').style.display = 'none';
  document.getElementById('rsSaveBtn').style.display = 'none';

  openModal('modal-review-search');
  setTimeout(() => { findEl.focus(); if (prefill) rsSearch(); }, 150);
}

function _rsGetOpts() {
  return {
    caseSensitive: document.getElementById('rsCaseSensitive').checked,
    wholeWord:     document.getElementById('rsWholeWord').checked,
    regex:         document.getElementById('rsRegex').checked,
  };
}

function rsSearch() {
  const term = document.getElementById('rsFind').value.trim();
  if (!term) { showToast('ใส่คำค้นหาก่อน', 'error'); return; }

  const opts     = _rsGetOpts();
  const chapters = S.currentWs?.chapters || [];

  _rsMatches       = [];
  _rsMatchIdx      = -1;
  _rsCurrentTexts  = {};
  _rsPendingChanges = {};

  // Snapshot live texts
  chapters.forEach(ch => { if (ch.translation) _rsCurrentTexts[ch.id] = ch.translation; });

  // Build match list — track occurrenceIndex within each chapter
  try {
    chapters.forEach(ch => {
      if (!ch.translation) return;
      const re   = buildFRRegex(term, opts, 'g');
      const hits = [...ch.translation.matchAll(re)];
      hits.forEach((m, occIdx) => {
        _rsMatches.push({
          chId: ch.id,
          chapterNum: ch.chapterNum,
          title:      ch.title || '',
          occurrenceIndex: occIdx, // which occurrence in the original text
          match:    m[0],
          replaced: false,
        });
      });
    });
  } catch(e) {
    showToast('Regex ไม่ถูกต้อง', 'error');
    return;
  }

  document.getElementById('rsEndMsg').style.display = 'none';
  document.getElementById('rsSaveBtn').style.display = 'none';

  if (!_rsMatches.length) {
    showToast(`ไม่พบ "${term}" ในทุกตอน`, 'info');
    ['rsProgressBar','rsContextWrap'].forEach(id => document.getElementById(id).style.display = 'none');
    document.getElementById('rsReplaceWrap').style.display = 'none';
    return;
  }

  _rsMatchIdx = 0;
  rsRenderCurrent();
}

function rsRenderCurrent() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const CONTEXT = 160;
  const term    = document.getElementById('rsFind').value.trim();
  const opts    = _rsGetOpts();
  const text    = _rsCurrentTexts[m.chId] || '';

  // How many earlier matches in the same chapter were REPLACED (text was removed)?
  const replacedBefore = _rsMatches
    .slice(0, _rsMatchIdx)
    .filter(x => x.chId === m.chId && x.replaced)
    .length;
  const occInCurrent = m.occurrenceIndex - replacedBefore;

  let hit;
  try {
    const re   = buildFRRegex(term, opts, 'g');
    const hits = [...text.matchAll(re)];
    hit = hits[occInCurrent];
  } catch(e) { hit = null; }

  if (!hit) { rsGoNext(); return; } // occurrence dissolved — skip silently

  const idx       = hit.index;
  const matchText = hit[0];
  const bStart    = Math.max(0, idx - CONTEXT);
  const aEnd      = Math.min(text.length, idx + matchText.length + CONTEXT);
  const before    = (bStart > 0 ? '…' : '') + text.slice(bStart, idx);
  const after     = text.slice(idx + matchText.length, aEnd) + (aEnd < text.length ? '…' : '');

  // Store slice boundaries for free-edit mode
  _rsBStartFull = bStart;
  _rsAEndFull   = aEnd;

  // Exit edit mode when navigating to new match
  if (_rsEditMode) rsExitEditMode();

  // Build context display
  const ctxDiv = document.getElementById('rsContextDisplay');
  ctxDiv.innerHTML = '';

  const bNode = document.createElement('span');
  bNode.style.cssText = 'color:var(--text-muted);white-space:pre-wrap';
  bNode.textContent = before;

  const markEl = document.createElement('mark');
  markEl.style.cssText = [
    'background:rgba(201,168,76,0.45)',
    'color:var(--gold-light)',
    'border-radius:3px',
    'padding:0 3px',
    'font-weight:700',
    'outline:2px solid var(--gold)',
    'white-space:pre-wrap',
  ].join(';');
  markEl.textContent = matchText;

  const aNode = document.createElement('span');
  aNode.style.cssText = 'color:var(--text-muted);white-space:pre-wrap';
  aNode.textContent = after;

  ctxDiv.appendChild(bNode);
  ctxDiv.appendChild(markEl);
  ctxDiv.appendChild(aNode);
  setTimeout(() => markEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 40);

  // Progress
  const pct = ((_rsMatchIdx + 1) / _rsMatches.length) * 100;
  document.getElementById('rsProgressFill').style.width = pct + '%';
  document.getElementById('rsCountInfo').textContent =
    `${_rsMatchIdx + 1} / ${_rsMatches.length} รายการ`;
  document.getElementById('rsCountInfo').style.color = 'var(--gold)';
  document.getElementById('rsChapterInfo').textContent =
    `ตอน ${m.chapterNum ?? '?'}: ${m.title}`;

  document.getElementById('rsProgressBar').style.display = 'block';
  document.getElementById('rsContextWrap').style.display  = 'block';
  document.getElementById('rsReplaceWrap').style.display  = 'flex';
  document.getElementById('rsEndMsg').style.display       = 'none';

  // Pre-fill replace input with the matched word
  const repEl = document.getElementById('rsReplaceInput');
  repEl.value = matchText;
  repEl.focus();
  repEl.select();
}

function rsReplaceAndNext() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const term       = document.getElementById('rsFind').value.trim();
  const replaceWith = document.getElementById('rsReplaceInput').value;
  const opts       = _rsGetOpts();

  const replacedBefore = _rsMatches
    .slice(0, _rsMatchIdx)
    .filter(x => x.chId === m.chId && x.replaced)
    .length;
  const occInCurrent = m.occurrenceIndex - replacedBefore;

  let text = _rsCurrentTexts[m.chId] || '';
  try {
    const re   = buildFRRegex(term, opts, 'g');
    const hits = [...text.matchAll(re)];
    const hit  = hits[occInCurrent];
    if (hit) {
      text = text.slice(0, hit.index) + replaceWith + text.slice(hit.index + hit[0].length);
      _rsCurrentTexts[m.chId]  = text;
      _rsPendingChanges[m.chId] = text;
      m.replaced = true;
    }
  } catch(e) {}

  rsGoNext();
}

function rsSkip() { rsGoNext(); }

// ── Free-edit mode ──
function rsToggleEditMode() {
  if (_rsEditMode) {
    rsExitEditMode();
  } else {
    rsEnterEditMode();
  }
}

function rsEnterEditMode() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  _rsEditMode = true;

  // Pre-fill textarea with the actual text slice (no decorative '…')
  const text    = _rsCurrentTexts[m.chId] || '';
  const snippet = text.slice(_rsBStartFull, _rsAEndFull);
  const editTa  = document.getElementById('rsContextEdit');
  editTa.value  = snippet;

  // Show textarea, hide highlight div and replace input
  document.getElementById('rsContextDisplay').style.display = 'none';
  editTa.style.display = 'block';
  document.getElementById('rsEditHint').style.display = 'block';
  document.getElementById('rsReplaceWrap').style.display = 'none';

  // Swap footer buttons
  document.getElementById('rsReplaceBtn').style.display  = 'none';
  document.getElementById('rsSkipBtn').style.display     = 'none';
  document.getElementById('rsSaveContextBtn').style.display = 'inline-flex';

  // Update toggle button label
  document.getElementById('rsEditToggleBtn').textContent = '✕ ยกเลิกแก้ไข';
  document.getElementById('rsEditToggleBtn').style.color = 'var(--crimson-light)';

  // Scroll to highlight (find position of match in textarea)
  const term  = document.getElementById('rsFind').value.trim();
  const opts  = _rsGetOpts();
  try {
    const re  = buildFRRegex(term, opts);
    const pos = snippet.search(re);
    if (pos >= 0) {
      editTa.focus();
      editTa.setSelectionRange(pos, pos + (snippet.match(re)?.[0]?.length || 0));
    } else {
      editTa.focus();
    }
  } catch(e) { editTa.focus(); }
}

function rsExitEditMode() {
  _rsEditMode = false;
  document.getElementById('rsContextDisplay').style.display = 'block';
  document.getElementById('rsContextEdit').style.display    = 'none';
  document.getElementById('rsEditHint').style.display       = 'none';
  document.getElementById('rsReplaceWrap').style.display    = 'flex';
  document.getElementById('rsReplaceBtn').style.display     = 'inline-flex';
  document.getElementById('rsSkipBtn').style.display        = 'inline-flex';
  document.getElementById('rsSaveContextBtn').style.display = 'none';
  document.getElementById('rsEditToggleBtn').textContent    = '✏ แก้ไขตรงๆ';
  document.getElementById('rsEditToggleBtn').style.color    = '';
}

function rsSaveContextAndNext() {
  const m = _rsMatches[_rsMatchIdx];
  if (!m) return;

  const editedSnippet = document.getElementById('rsContextEdit').value;
  const fullText      = _rsCurrentTexts[m.chId] || '';
  const newText       = fullText.slice(0, _rsBStartFull) + editedSnippet + fullText.slice(_rsAEndFull);

  if (newText !== fullText) {
    _rsCurrentTexts[m.chId]   = newText;
    _rsPendingChanges[m.chId] = newText;
    m.replaced = true; // mark so occurrence indices adjust
  }

  rsExitEditMode();
  rsGoNext();
}

function rsNavPrev() {
  if (_rsMatchIdx > 0) {
    _rsMatchIdx--;
    document.getElementById('rsEndMsg').style.display = 'none';
    rsRenderCurrent();
  }
}

function rsGoNext() {
  if (_rsMatchIdx < _rsMatches.length - 1) {
    _rsMatchIdx++;
    rsRenderCurrent();
  } else {
    // All done
    document.getElementById('rsContextWrap').style.display  = 'none';
    document.getElementById('rsReplaceWrap').style.display  = 'none';
    document.getElementById('rsEndMsg').style.display       = 'block';
    document.getElementById('rsSaveBtn').style.display         = 'inline-flex';
    document.getElementById('rsSkipBtn').style.display         = 'none';
    document.getElementById('rsReplaceBtn').style.display      = 'none';
    document.getElementById('rsSaveContextBtn').style.display  = 'none';
    if (_rsEditMode) rsExitEditMode();

    const info = document.getElementById('rsCountInfo');
    info.textContent = `✓ ตรวจครบ ${_rsMatches.length} รายการ`;
    info.style.color = '#4caf50';
    document.getElementById('rsProgressFill').style.width = '100%';
  }
}

async function rsSaveAndClose() {
  const changedIds = Object.keys(_rsPendingChanges);
  if (changedIds.length) {
    const chs = S.currentWs?.chapters || [];
    chs.forEach(ch => {
      if (_rsPendingChanges[ch.id] !== undefined) {
        ch.translation = _rsPendingChanges[ch.id];
        ch.updatedAt   = Date.now();
        // recalculate wordCount
        ch.wordCount   = ch.translation.length;
      }
    });
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    showToast(`บันทึกการแก้ไข ${changedIds.length} ตอนแล้ว ✓`, 'success');
  }
  closeModal('modal-review-search');

  // Reset button states for next open
  _rsEditMode = false;
  document.getElementById('rsSkipBtn').style.display        = '';
  document.getElementById('rsReplaceBtn').style.display     = '';
  document.getElementById('rsSaveContextBtn').style.display = 'none';
  document.getElementById('rsEditToggleBtn').textContent    = '✏ แก้ไขตรงๆ';
  document.getElementById('rsEditToggleBtn').style.color    = '';
}

// ─── Consistency Check ───
function openConsistencyCheck() {
  const text = document.getElementById('translationOutput').innerText?.trim() || '';
  document.getElementById('ccTranslation').value = text !== 'คำแปลจะปรากฏที่นี่...' ? text : '';
  document.getElementById('ccResults').style.display = 'none';
  openModal('modal-consistency');
}

async function runConsistencyCheck() {
  const translation = document.getElementById('ccTranslation').value.trim();
  if (!translation) { showToast('ใส่คำแปลก่อน', 'error'); return; }
  if (!S.glossaryData?.length) { showToast('ยังไม่มีคลังศัพท์ใน Workspace', 'error'); return; }
  const btn = document.getElementById('ccRunBtn');
  btn.disabled = true; btn.textContent = '🔗 กำลังตรวจ...';
  try {
    const issues = [];

    // 1. ตรวจ: คำเกาหลียังหลงเหลือในคำแปล
    S.glossaryData.forEach(g => {
      if ((g.type === 'character' || g.type === 'title') && translation.includes(g.korean)) {
        issues.push({ type: '⚠ ชื่อเกาหลีหลงเหลือ', found: g.korean, expected: `ควรเป็น ${g.thai}` });
      }
    });

    // 2. ตรวจ: สรรพนามผิดเพศ (client-side, no AI)
    // หาชื่อ Thai ของตัวละครที่มี gender แล้วสแกนบริบท
    const MALE_WRONG   = ['เธอ', 'ของเธอ', 'นาง', 'หนู', 'ฉัน', 'อิฉัน'];
    const FEMALE_WRONG = ['เขา', 'ของเขา', 'ผม', 'กู', 'ข้า'];
    const sentences = translation.split(/[。.!?!?।\n]/).filter(s => s.length > 5);

    S.glossaryData.forEach(g => {
      if (g.type !== 'character' || !g.gender || g.gender === 'neutral') return;
      const wrongPronouns = g.gender === 'male' ? MALE_WRONG : FEMALE_WRONG;
      const thaiName = g.thai;
      if (!thaiName) return;
      // หาประโยคที่มีชื่อตัวละคร + สรรพนามผิดเพศ
      sentences.forEach(sent => {
        if (!sent.includes(thaiName)) return;
        wrongPronouns.forEach(pronoun => {
          if (sent.includes(pronoun)) {
            issues.push({
              type: `🚨 สรรพนามผิดเพศ`,
              found: `"${thaiName}" (${g.gender}) + "${pronoun}"`,
              expected: g.gender === 'male' ? 'ควรใช้: เขา/ผม/กู' : 'ควรใช้: เธอ/นาง/ฉัน',
            });
          }
        });
      });
    });

    // 3. ตรวจ: glossary term ที่ควรปรากฏแต่ไม่อยู่ในแปล
    const relevant = getSmartGlossary(document.getElementById('ccTranslation').value, S.glossaryData);
    // (ตรวจ coverage แบบ optional — ไม่ใช้ AI)

    const score = Math.max(0, 100 - issues.filter(i => i.type.startsWith('🚨')).length * 15
                                    - issues.filter(i => i.type.startsWith('⚠')).length * 5);
    const suggestions = [];
    if (issues.some(i => i.type.startsWith('🚨'))) suggestions.push('ตรวจสอบสรรพนาม เขา/เธอ/ผม/ฉัน ให้ตรงกับเพศตัวละคร');
    if (issues.some(i => i.type.startsWith('⚠'))) suggestions.push('มีชื่อเกาหลีหลงเหลือ — แทนที่ด้วยชื่อไทยในคลังศัพท์');
    renderConsistencyResult({ overallScore: score, issues, suggestions });
    document.getElementById('ccResults').style.display = 'block';
  } catch (e) { showToast('ตรวจไม่สำเร็จ: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '🔗 ตรวจสอบ'; }
}

function renderConsistencyResult(data) {
  const score = data.overallScore ?? 100;
  const scoreClass = score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad';
  const scoreLabel = score >= 80 ? 'สอดคล้องดี' : score >= 60 ? 'มีปัญหาเล็กน้อย' : 'ต้องแก้ไข';
  document.getElementById('ccScoreBar').innerHTML = `
    <span class="cc-score-num ${scoreClass}">${score}</span>
    <div><div style="font-size:0.85rem;color:var(--text-primary);font-weight:600">${scoreLabel}</div>
    <div class="cc-score-label">คะแนนความสอดคล้อง / 100</div></div>`;
  const issueList = document.getElementById('ccIssueList');
  if (!data.issues?.length) { issueList.innerHTML = '<div style="font-size:0.82rem;color:#4caf50;padding:6px 0">✓ ไม่พบปัญหา</div>'; }
  else { issueList.innerHTML = data.issues.map(i => `<div class="cc-issue"><div class="cc-issue-type">${i.type}</div><div>พบ: <span class="cc-issue-found">${esc(i.found||'')}</span>${i.expected ? ` → ควรเป็น: <span class="cc-issue-expected">${esc(i.expected)}</span>` : ''}</div></div>`).join(''); }
  const suggEl = document.getElementById('ccSuggestions');
  if (data.suggestions?.length) { suggEl.innerHTML = data.suggestions.map(s => `<div class="cc-sugg-item">${esc(s)}</div>`).join(''); suggEl.style.display = 'block'; }
  else { suggEl.style.display = 'none'; }
}

// ─── Export ───
function openExportModal() {
  const wsName = S.currentWs?.name;
  const label = document.getElementById('wsExportLabel');
  const btns = document.getElementById('wsExportBtns');
  if (wsName) { label.textContent = `📚 Export ทั้ง Workspace — ${wsName}`; btns.style.display = 'flex'; }
  else { label.textContent = ''; btns.style.display = 'none'; }
  openModal('modal-export');
}

function getTranslationText() {
  const text = document.getElementById('translationOutput').innerText?.trim() || '';
  return text === 'คำแปลจะปรากฏที่นี่...' ? '' : text;
}

function exportCurrentTXT() {
  const text = getTranslationText();
  if (!text) { showToast('ยังไม่มีคำแปล', 'error'); return; }
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${S.currentWs?.name || 'translation'}.txt`);
  showToast('Export TXT สำเร็จ ✓', 'success');
}

function exportWorkspaceTXT() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a, b) => (a.chapterNum||0) - (b.chapterNum||0));
  const text = chapters.map(ch => `=== ${ch.title} ===\n\n${ch.translation || '(ยังไม่มีคำแปล)'}`).join('\n\n\n');
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${S.currentWs.name}.txt`);
  showToast('Export TXT สำเร็จ ✓', 'success');
}

// ── DOCX helpers ──
function buildDocxXml(title, paragraphs) {
  const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const paras = paragraphs.map(p => {
    if (!p.trim()) return '<w:p/>';
    const lines = p.split('\n');
    return lines.map(line => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
  }).join('');
  const titleXml = title ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(title)}</w:t></w:r></w:p><w:p/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${titleXml}${paras}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`;
}

function buildDocxZip(docXml) {
  // Build a minimal .docx (ZIP) containing word/document.xml
  const files = {
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    'word/document.xml': docXml,
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  };
  return buildZipBuffer(files);
}

function exportCurrentDOCX() {
  const text = getTranslationText();
  if (!text) { showToast('ยังไม่มีคำแปล', 'error'); return; }
  const docXml = buildDocxXml(S.currentWs?.name || '', text.split('\n\n'));
  const buf = buildDocxZip(docXml);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${S.currentWs?.name || 'translation'}.docx`);
  showToast('Export DOCX สำเร็จ ✓', 'success');
}

function exportWorkspaceDOCX() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  const escXml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const body = chapters.map(ch => {
    const heading = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t>${escXml(ch.title)}</w:t></w:r></w:p><w:p/>`;
    const content = (ch.translation || '(ยังไม่มีคำแปล)').split('\n').map(line =>
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/></w:rPr><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
    return heading + content + '<w:p/><w:p/>';
  }).join('');
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const buf = buildDocxZip(docXml);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${S.currentWs.name}.docx`);
  showToast('Export DOCX สำเร็จ ✓', 'success');
}

function exportWorkspaceZIP() {
  if (!S.currentWs) return;
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  const files = {};
  chapters.forEach(ch => {
    const num = String(ch.chapterNum || '0').padStart(3, '0');
    const safeName = ch.title.replace(/[\\/:*?"<>|]/g, '_');
    const fname = `${num}_${safeName}.txt`;
    files[fname] = ch.translation || '(ยังไม่มีคำแปล)';
  });
  const buf = buildZipBuffer(files);
  downloadBlob(new Blob([buf], { type: 'application/zip' }), `${S.currentWs.name}.zip`);
  showToast('Export ZIP สำเร็จ ✓', 'success');
}

// ── Pure-JS ZIP builder ──
function buildZipBuffer(files) {
  const enc = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = crc32.table || (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
      }
      return t;
    })());
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16le(v) { return [(v & 0xFF), (v >> 8) & 0xFF]; }
  function u32le(v) { return [(v & 0xFF), (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]; }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const a of arrays) { out.set(a, pos); pos += a.length; }
    return out;
  }

  const parts = [];
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const dataBytes = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array([
      0x50,0x4B,0x03,0x04, // sig
      0x14,0x00, // version
      0x00,0x00, // flags
      0x00,0x00, // compression (stored)
      0x00,0x00, 0x00,0x00, // mod time/date
      ...u32le(crc),
      ...u32le(dataBytes.length),
      ...u32le(dataBytes.length),
      ...u16le(nameBytes.length),
      0x00,0x00, // extra len
      ...nameBytes,
    ]);
    localHeaders.push({ name: nameBytes, offset, crc, size: dataBytes.length });
    parts.push(localHeader, dataBytes);
    offset += localHeader.length + dataBytes.length;
  }

  const centralStart = offset;
  for (const lh of localHeaders) {
    const centralEntry = new Uint8Array([
      0x50,0x4B,0x01,0x02,
      0x14,0x00, 0x14,0x00,
      0x00,0x00, 0x00,0x00,
      0x00,0x00, 0x00,0x00,
      ...u32le(lh.crc),
      ...u32le(lh.size),
      ...u32le(lh.size),
      ...u16le(lh.name.length),
      0x00,0x00,             // extra field length
      0x00,0x00,             // file comment length
      0x00,0x00,             // disk number start
      0x00,0x00,             // internal file attributes
      0x00,0x00,0x00,0x00,   // external file attributes (4 bytes)
      ...u32le(lh.offset),
      ...lh.name,
    ]);
    parts.push(centralEntry);
    offset += centralEntry.length;
  }

  const centralSize = offset - centralStart;
  const eocd = new Uint8Array([
    0x50,0x4B,0x05,0x06,
    0x00,0x00, 0x00,0x00,
    ...u16le(localHeaders.length),
    ...u16le(localHeaders.length),
    ...u32le(centralSize),
    ...u32le(centralStart),
    0x00,0x00,
  ]);
  parts.push(eocd);
  return concat(...parts);
}
