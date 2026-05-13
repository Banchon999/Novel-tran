'use strict';
// ══════════════════════════════════════════════
// modules/batch.js — Batch chapter translation, utilities
// ══════════════════════════════════════════════
// ─── Batch Chapter Translate ───
function openBatchChapters() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const chapters = [...(S.currentWs.chapters || [])].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (!chapters.length) { showToast('ยังไม่มีตอน', 'error'); return; }
  document.getElementById('bchChapterList').innerHTML = chapters.map(ch => `
    <label class="bch-ch-row" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer">
      <input type="checkbox" class="bch-chk" data-id="${ch.id}" style="accent-color:var(--gold)"
        onclick="rangeCheckboxClick(event,'bch-modal','.bch-chk',bchUpdateCount)"
        onchange="bchUpdateCount()" title="Shift+คลิก เพื่อเลือกช่วง"/>
      <span style="font-size:0.76rem;color:var(--text-muted);min-width:26px">#${ch.chapterNum||'?'}</span>
      <span style="flex:1;font-size:0.82rem;color:var(--text-primary)">${esc(ch.title)}</span>
      <span class="status-badge ${ch.status==='translated'?'translated':'pending'}" style="font-size:0.6rem">${ch.status==='translated'?'&#10003; แปลแล้ว':'&#9675; รอ'}</span>
      <span style="font-size:0.68rem;color:var(--text-muted)">${ch.sourceText?ch.sourceText.length.toLocaleString()+' ตัวอักษร':'&#8212;'}</span>
    </label>
  `).join('');
  document.getElementById('bchModel').value = document.getElementById('translateModel').value;
  document.getElementById('bchProgressBox').style.display = 'none';
  document.getElementById('bchLog').innerHTML = '';
  document.getElementById('bchStartBtn').disabled = false;
  document.getElementById('bchSelectedCount').textContent = '0 ตอนที่เลือก';
  openModal('modal-batch-chapters');
}
function bchUpdateCount() {
  document.getElementById('bchSelectedCount').textContent = `${document.querySelectorAll('.bch-chk:checked').length} ตอนที่เลือก`;
}
function bchSelectAll()    { document.querySelectorAll('.bch-chk').forEach(el => el.checked = true);  bchUpdateCount(); }
function bchDeselectAll()  { document.querySelectorAll('.bch-chk').forEach(el => el.checked = false); bchUpdateCount(); }
function bchSelectPending() {
  document.querySelectorAll('.bch-chk').forEach(el => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status !== 'translated';
  });
  bchUpdateCount();
}
async function startBatchChapters() {
  const checked = [...document.querySelectorAll('.bch-chk:checked')];
  if (!checked.length) { showToast('เลือกตอนก่อน', 'error'); return; }
  if (S.translating) { showToast('กำลังแปลอยู่', 'error'); return; }
  const skipTranslated = document.getElementById('bchSkipTranslated').checked;
  const model          = document.getElementById('bchModel').value;
  const usePolish      = document.getElementById('bchUsePolish').checked;
  const usePrevContext = document.getElementById('bchUsePrevContext').checked;
  // Batch: glossaryStr จะสร้างใหม่ per chapter (smart filtering)
  let selectedChapters = checked
    .map(el => S.currentWs.chapters.find(c => c.id === el.dataset.id)).filter(Boolean)
    .sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
  if (skipTranslated) selectedChapters = selectedChapters.filter(ch => ch.status !== 'translated');
  if (!selectedChapters.length) { showToast('ไม่มีตอนที่ต้องแปล', ''); return; }
  setTranslating(true);
  const btn = document.getElementById('bchStartBtn');
  btn.disabled = true;
  const log = document.getElementById('bchLog');
  document.getElementById('bchProgressBox').style.display = 'block';
  log.innerHTML = '';
  if (!getApiKey()) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); btn.disabled = false; return; }
  const n = selectedChapters.length;

  // ── Summary cache: chapterId → summary string ──
  const _summaryCache = {};
  const CONCURRENCY = 5; // parallel summary calls สูงสุด

  // helper: สร้าง prompt สรุปสำหรับ prevCh
  function buildSummaryPrompt(prevCh) {
    const textSample = prevCh.translation.length > 6000
      ? prevCh.translation.slice(0, 3000) + '\n...\n' + prevCh.translation.slice(-3000)
      : prevCh.translation;
    return CHAPTER_SUMMARY_PROMPT
      .replace('{chapter_num}',   prevCh.chapterNum || '?')
      .replace('{chapter_title}', prevCh.title)
      .replace('{text}',          textSample);
  }

  // helper: หาตอนก่อนหน้าที่แปลแล้ว
  const allSorted = [...(S.currentWs.chapters||[])].sort((a,b)=>(a.chapterNum||0)-(b.chapterNum||0));
  function findPrevTranslated(ch) {
    const idx = allSorted.findIndex(c => c.id === ch.id);
    for (let i = idx - 1; i >= 0; i--) {
      if (allSorted[i].translation?.trim()) return allSorted[i];
    }
    return null;
  }

  // ── PHASE 1: Pre-summarize pass (parallel, concurrency = 5) ──
  if (usePrevContext) {
    // รวบรวม prevCh ที่ต้องสรุป (unique, มี translation, ยังไม่ cache)
    const toSummarize = [];
    const seen = new Set();
    for (const ch of selectedChapters) {
      const prev = findPrevTranslated(ch);
      if (prev && !seen.has(prev.id) && !_summaryCache[prev.id]) {
        seen.add(prev.id);
        toSummarize.push(prev);
      }
    }

    if (toSummarize.length) {
      addLog(log, `📝 Pre-summarize ${toSummarize.length} ตอน (parallel x${Math.min(CONCURRENCY, toSummarize.length)})...`, '');
      document.getElementById('bchProgressLabel').textContent = `[เฟส 1/2] สรุปบริบท 0/${toSummarize.length} ตอน...`;

      let doneSum = 0;

      // run with concurrency limit
      async function runWithConcurrency(tasks, limit) {
        const results = new Array(tasks.length);
        let idx = 0;
        async function worker() {
          while (idx < tasks.length) {
            const i = idx++;
            results[i] = await tasks[i]();
          }
        }
        const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
        await Promise.all(workers);
        return results;
      }

      const tasks = toSummarize.map(prevCh => async () => {
        try {
          const res = await callOpenRouter({
            model,
            messages: [{ role: 'user', content: buildSummaryPrompt(prevCh) }],
            temperature: 0.1,
            max_tokens: 300,
          });
          _summaryCache[prevCh.id] = res.choices?.[0]?.message?.content?.trim() || '';
        } catch {
          // fallback: ท้าย 600 ตัวอักษร — mark ด้วย key พิเศษ
          _summaryCache[prevCh.id] = '__fallback__' + prevCh.translation.trim().slice(-600);
        }
        doneSum++;
        document.getElementById('bchProgressLabel').textContent = `[เฟส 1/2] สรุปบริบท ${doneSum}/${toSummarize.length} ตอน...`;
        document.getElementById('bchProgressFill').style.width = Math.round(doneSum / toSummarize.length * 30) + '%';
        document.getElementById('bchProgressPct').textContent = Math.round(doneSum / toSummarize.length * 30) + '%';
        addLog(log, `📝 สรุปตอน #${prevCh.chapterNum||'?'} "${prevCh.title}" ✓`, 'cached');
      });

      await runWithConcurrency(tasks, CONCURRENCY);
      document.getElementById('bchProgressLabel').textContent = `[เฟส 2/2] กำลังแปล ${n} ตอน...`;
      addLog(log, `✓ Pre-summarize เสร็จ — เริ่มแปล ${n} ตอน`, 'success');
    }
  }

  // helper: ดึง context string จาก cache
  function getCtxFromCache(ch) {
    const prev = findPrevTranslated(ch);
    if (!prev) return '';
    const cached = _summaryCache[prev.id];
    if (!cached) return '';
    if (cached.startsWith('__fallback__')) {
      return `PREVIOUS CHAPTER CONTEXT (ตอน #${prev.chapterNum||'?'} "${prev.title}") — ท้ายตอน:\n${cached.slice(12)}\n`;
    }
    return `PREVIOUS CHAPTER SUMMARY (ตอน #${prev.chapterNum||'?'} "${prev.title}"):\n${cached}\n`;
  }

  // ── PHASE 2: แปลทีละตอน (sequential) ──
  addLog(log, `⚡ เริ่มแปล ${n} ตอน...`, '');
  let batchStopped = false;
  for (let i = 0; i < n; i++) {
    const ch = selectedChapters[i];
    const pct = 30 + Math.round(i / n * 70); // progress 30%→100% ในช่วงแปล
    document.getElementById('bchProgressFill').style.width = pct + '%';
    document.getElementById('bchProgressPct').textContent = pct + '%';
    document.getElementById('bchProgressLabel').textContent = `แปลตอน ${i+1}/${n}: ${ch.title}`;
    if (!ch.sourceText?.trim()) {
      addLog(log, `⚠ #${ch.chapterNum||'?'} "${ch.title}" — ไม่มีต้นฉบับ ข้าม`, 'error');
      continue;
    }
    const ctxStr = usePrevContext ? getCtxFromCache(ch) : '';
    addLog(log, `⚡ #${ch.chapterNum||'?'} ${ch.title}${ctxStr ? ' [+summary]' : ''}...`, '');
    try {
      const styleId = document.getElementById('activeStyleSelect')?.value || S.activeStyleId;
      const csp = BUILTIN_STYLES[styleId]?.prompt || S.currentWs?.customStyles?.find(s=>s.id===styleId)?.prompt || null;
      // Smart Glossary per chapter (ลด token)
      const chSmartGloss = getSmartGlossary(ch.sourceText, S.glossaryData);
      const chGlossObj = chSmartGloss.reduce((acc, g) => { acc[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return acc; }, {});
      const chGlossaryStr = buildGlossaryStr(chGlossObj);
      const batchPreset = getActivePreset(S.currentWs);
      const prompt = buildTranslatePrompt({
        sourceText: prepareSourceForTranslation(ch.sourceText),
        glossaryStr: chGlossaryStr,
        contextStr: ctxStr,
        styleNote: csp || '',
        ws: S.currentWs,
      });
      S.abortCtrl = new AbortController();
      const timer = setTimeout(() => S.abortCtrl.abort(), 180000);
      let fullText = '', inTok = 0, outTok = 0;
      try {
        fullText = await sseStream(
          OPENROUTER_API_URL,
          { model, temperature: batchPreset.temperature ?? 0.65, max_tokens: Math.max(4000, Math.ceil(ch.sourceText.length * 2)), messages: [{role:'user',content:prompt}] },
          d => { fullText += d; }, (inp,out) => { inTok=inp; outTok=out; }, S.abortCtrl.signal
        );
      } finally { clearTimeout(timer); }
      if (inTok||outTok) addCosts(inTok, outTok, model);
      if (usePolish && fullText) {
        try {
          const pr = await callOpenRouter({ model, messages:[{role:'user',content:POLISH_PROMPT.replace('{glossary}',chGlossaryStr).replace('{text}',fullText)}], temperature:0.5, max_tokens:Math.max(4000,Math.ceil(fullText.length*1.2)) });
          fullText = pr.choices?.[0]?.message?.content?.trim() || fullText;
        } catch {}
      }
      ch.translation = fullText; ch.status = 'translated'; ch.wordCount = fullText.length; ch.updatedAt = Date.now();
      await lsSaveWorkspace(S.currentWs);
      addLog(log, `✓ #${ch.chapterNum||'?'} "${ch.title}" — ${fullText.length.toLocaleString()} ตัวอักษร`, 'success');
    } catch (err) {
      if (err.name === 'AbortError') {
        addLog(log, `⬛ หยุดที่ตอน #${ch.chapterNum||'?'} "${ch.title}"`, 'error');
        batchStopped = true;
        break;
      }
      addLog(log, `✗ #${ch.chapterNum||'?'} "${ch.title}" — ${err.message}`, 'error');
    }
    document.getElementById('bchProgressFill').style.width = (30 + Math.round((i+1)/n*70)) + '%';
    document.getElementById('bchProgressPct').textContent  = (30 + Math.round((i+1)/n*70)) + '%';
  }

  document.getElementById('bchProgressFill').style.width = '100%';
  document.getElementById('bchProgressPct').textContent   = '100%';
  document.getElementById('bchProgressLabel').textContent = batchStopped ? 'หยุดแล้ว ⬛' : `เสร็จสิ้น ${n} ตอน ✓`;
  renderChapters();
  setTranslating(false);
  btn.disabled = false;
  showToast(batchStopped ? '⬛ หยุด Batch แล้ว' : `Batch แปลเสร็จ ${n} ตอน ✓`, batchStopped ? '' : 'success');

  // ── Auto Extract Glossary จาก source texts ทั้ง batch รวมกัน (ครั้งเดียว) ──
  if (!batchStopped) {
    const allSource = selectedChapters
      .map(ch => ch.sourceText?.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);
    // สร้าง label แสดงช่วงตอน
    const firstCh = selectedChapters[0];
    const lastCh  = selectedChapters[selectedChapters.length - 1];
    const batchChInfo = firstCh ? {
      id: null,
      title: firstCh.id === lastCh.id
        ? firstCh.title
        : `#${firstCh.chapterNum||'?'}–#${lastCh.chapterNum||'?'}`,
      chapterNum: firstCh.chapterNum || null,
    } : null;
    const allTranslation = selectedChapters
      .map(ch => ch.translation?.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 6000);
    autoExtractGlossaryAfterTranslation(allSource, model, batchChInfo, allTranslation);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Utilities ───
function setTranslating(val) {
  S.translating = val;
  const btn = document.getElementById('translateBtn');
  if (!btn) return;
  if (val) {
    btn.innerHTML = '⬛ หยุด';
    btn.classList.add('btn-stop');
    btn.onclick = stopTranslation;
  } else {
    btn.innerHTML = '⚡ แปล';
    btn.classList.remove('btn-stop');
    btn.onclick = startTranslation;
    S.abortCtrl = null;
  }
}

function stopTranslation() {
  if (!S.translating) return;
  if (S.abortCtrl) { S.abortCtrl.abort(); }
  showToast('⬛ กำลังหยุด...', '');
}
function updateSourceStats() {
  const len = document.getElementById('sourceText').value.length;
  document.getElementById('sourceStats').textContent = `${len.toLocaleString()} ตัวอักษร`;
}
function clearSource() { document.getElementById('sourceText').value = ''; updateSourceStats(); hideHighlight(); }
function clearTranslation() {
  document.getElementById('translationOutput').innerHTML = '<div class="output-placeholder">คำแปลจะปรากฏที่นี่...</div>';
  document.getElementById('translationStats').textContent = 'รอการแปล';
}
async function copyTranslation() {
  const text = document.getElementById('translationOutput').innerText.trim();
  if (!text || text === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }
  try { await navigator.clipboard.writeText(text); showToast('คัดลอกแล้ว ✓', 'success'); }
  catch { showToast('คัดลอกล้มเหลว', 'error'); }
}
function addLog(el, msg, cls) {
  const d = document.createElement('div');
  d.className = 'log-entry' + (cls ? ' ' + cls : '');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

let _toastTimer = null;
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ─── Load from Chapter (Translate Tab) ───
function openLoadFromChapter() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const chapters = S.currentWs.chapters || [];
  const listEl = document.getElementById('loadChapterList');
  if (!chapters.length) {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:10px 0">ยังไม่มีตอน</div>';
  } else {
    const sorted = [...chapters].sort((a,b) => (a.chapterNum||0)-(b.chapterNum||0));
    listEl.innerHTML = sorted.map(ch => `
      <div onclick="loadChapterSource('${ch.id}')" style="
        padding:10px 12px; background:var(--bg-deep); border:1px solid var(--border);
        border-radius:var(--radius); cursor:pointer; transition:all 0.15s;
        display:flex; align-items:center; gap:10px;
      " onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-deep)'">
        <span style="font-size:0.7rem;font-family:var(--font-mono);color:var(--text-muted);min-width:28px">#${ch.chapterNum||'?'}</span>
        <span style="flex:1;font-size:0.85rem;color:var(--text-primary)">${esc(ch.title)}</span>
        <span style="font-size:0.65rem;color:${ch.sourceText?'#4caf50':'var(--text-muted)'}">
          ${ch.sourceText ? `${ch.sourceText.length.toLocaleString()} ตัวอักษร` : 'ไม่มีต้นฉบับ'}
        </span>
      </div>
    `).join('');
  }
  openModal('modal-load-chapter');
}

function loadChapterSource(id) {
  const ch = S.currentWs?.chapters.find(c => c.id === id);
  if (!ch) return;
  if (!ch.sourceText) { showToast('ตอนนี้ไม่มีข้อความต้นฉบับ', 'error'); return; }
  document.getElementById('sourceText').value = ch.sourceText;
  updateSourceStats();
  closeModal('modal-load-chapter');
  showToast(`โหลด "${ch.title}" แล้ว`, 'success');
}
