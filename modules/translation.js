'use strict';
// ══════════════════════════════════════════════
// modules/translation.js — Translation engine, streaming, chunking, styles
// ══════════════════════════════════════════════

// ─── Styles ───
function renderBuiltinStyles() {
  const grid = document.getElementById('builtinStylesGrid');
  if (!grid) return;
  grid.innerHTML = Object.values(BUILTIN_STYLES).map(s => `
    <div class="style-card ${S.activeStyleId === s.id ? 'active' : ''}" onclick="setActiveStyle('${s.id}')">
      <span class="style-emoji">${s.emoji}</span>
      <span class="style-name">${s.name}</span>
    </div>
  `).join('');
}

function renderStyles() {
  renderBuiltinStyles();
  const grid = document.getElementById('customStylesGrid');
  const customs = S.currentWs?.customStyles || [];
  if (!customs.length) {
    grid.innerHTML = '<div class="styles-empty">ยังไม่มี — กด ＋ สร้าง Style</div>';
    return;
  }
  grid.innerHTML = customs.map(s => `
    <div class="style-card ${S.activeStyleId === s.id ? 'active' : ''}" onclick="setActiveStyle('${s.id}')">
      <span class="style-emoji">${s.emoji || '🖊'}</span>
      <span class="style-name">${esc(s.name)}</span>
      <button class="style-edit" onclick="event.stopPropagation();openEditStyle('${s.id}')" title="แก้ไข Style นี้">✏</button>
    </div>
  `).join('');
}

function renderStyleSelect() {
  const sel = document.getElementById('activeStyleSelect');
  const customs = S.currentWs?.customStyles || [];
  const builtins = Object.values(BUILTIN_STYLES).map(s => `<option value="${s.id}">${s.emoji} ${s.name}</option>`).join('');
  const customOpts = customs.map(s => `<option value="${s.id}">${s.emoji || '🖊'} ${esc(s.name)}</option>`).join('');
  sel.innerHTML = builtins + (customOpts ? `<optgroup label="Custom">${customOpts}</optgroup>` : '');
  sel.value = S.activeStyleId;
}

async function setActiveStyle(id) {
  S.activeStyleId = id;
  const sel = document.getElementById('activeStyleSelect');
  if (sel) sel.value = id;
  renderBuiltinStyles();
  if (S.currentWs) {
    renderStyles();
    // Save to workspace settings so it persists
    S.currentWs.settings = { ...(S.currentWs.settings || {}), activeStyleId: id };
    await lsSaveWorkspace(S.currentWs);
  }
}

function openNewStyle() {
  S.editingStyleId = null;
  document.getElementById('styleModalTitle').textContent = '＋ สร้าง Style';
  ['styleEmoji','styleName','stylePrompt','styleTestText'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('stylePreviewResult').style.display = 'none';
  document.getElementById('deleteStyleBtn').style.display = 'none';
  openModal('modal-new-style');
}

function openEditStyle(id) {
  const style = S.currentWs?.customStyles?.find(s => s.id === id);
  if (!style) return;
  S.editingStyleId = id;
  document.getElementById('styleModalTitle').textContent = '✏ แก้ไข Style';
  document.getElementById('styleEmoji').value = style.emoji || '';
  document.getElementById('styleName').value = style.name;
  document.getElementById('stylePrompt').value = style.prompt;
  document.getElementById('styleTestText').value = '';
  document.getElementById('stylePreviewResult').style.display = 'none';
  document.getElementById('deleteStyleBtn').style.display = 'inline-flex';
  openModal('modal-new-style');
}

async function saveStyle() {
  const name = document.getElementById('styleName').value.trim();
  const prompt = document.getElementById('stylePrompt').value.trim();
  if (!name || !prompt) { showToast('กรอกชื่อและ Prompt ก่อน', 'error'); return; }
  const styleObj = { id: S.editingStyleId || genId(), name, emoji: document.getElementById('styleEmoji').value.trim() || '🖊', prompt };
  if (!S.currentWs.customStyles) S.currentWs.customStyles = [];
  if (S.editingStyleId) {
    const idx = S.currentWs.customStyles.findIndex(s => s.id === S.editingStyleId);
    if (idx >= 0) S.currentWs.customStyles[idx] = styleObj;
    else S.currentWs.customStyles.push(styleObj);
  } else {
    S.currentWs.customStyles.push(styleObj);
  }
  S.editingStyleId = null;  // reset after save
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-new-style');
  renderStyles(); renderStyleSelect();
  showToast('บันทึก Style แล้ว ✓', 'success');
}

async function deleteStyle() {
  if (!S.editingStyleId || !confirm('ลบ Style นี้?')) return;
  S.currentWs.customStyles = S.currentWs.customStyles.filter(s => s.id !== S.editingStyleId);
  if (S.activeStyleId === S.editingStyleId) {
    S.activeStyleId = 'natural';
    S.currentWs.settings = { ...(S.currentWs.settings || {}), activeStyleId: 'natural' };
  }
  S.editingStyleId = null;  // reset after delete
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-new-style');
  renderStyles(); renderStyleSelect();
  showToast('ลบ Style แล้ว', '');
}

async function previewStyle() {
  const text = document.getElementById('styleTestText').value.trim();
  const stylePromptTxt = document.getElementById('stylePrompt').value.trim();
  if (!text || !stylePromptTxt) { showToast('ใส่ข้อความและ Prompt ก่อน', 'error'); return; }
  const resultEl = document.getElementById('stylePreviewResult');
  resultEl.textContent = 'กำลังทดสอบ...';
  resultEl.style.display = 'block';
  try {
    const result = await translateSegmentDirect(text, [], { model: document.getElementById('translateModel').value, customStylePrompt: stylePromptTxt, useMemory: false });
    resultEl.textContent = result.translation || '(ไม่มีผลลัพธ์)';
  } catch (e) { resultEl.textContent = '❌ ' + e.message; }
}

// ════════════════════ TRANSLATION CORE ════════════════════

function getOptions() {
  const styleId = document.getElementById('activeStyleSelect')?.value || S.activeStyleId;
  let customStylePrompt = null;
  if (BUILTIN_STYLES[styleId]) customStylePrompt = BUILTIN_STYLES[styleId].prompt;
  else {
    const custom = S.currentWs?.customStyles?.find(s => s.id === styleId);
    if (custom) customStylePrompt = custom.prompt;
  }
  const wsGlossary = {};
  (S.currentWs?.glossary || []).forEach(g => { wsGlossary[g.korean] = { thai: g.thai, type: g.type, note: g.note }; });

  // Prev chapter context
  let prevChapterContext = '';
  const usePrev = document.getElementById('usePrevChapter')?.checked;
  if (usePrev && S.currentWs?.chapters?.length) {
    const srcType = document.getElementById('prevChapterType')?.value || 'translation';
    const chapters = S.currentWs.chapters;
    const curId = S.editingChapterId;
    const curIdx = curId ? chapters.findIndex(c => c.id === curId) : -1;
    let prevCh = null;
    if (curIdx > 0) {
      prevCh = chapters[curIdx - 1];
    } else if (!curId) {
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (chapters[i].translation) { prevCh = chapters[i]; break; }
      }
    }
    if (prevCh) {
      const ctxText = srcType === 'source' ? prevCh.sourceText : prevCh.translation;
      if (ctxText?.trim()) {
        const label = srcType === 'source' ? 'PREVIOUS CHAPTER (Original)' : 'PREVIOUS CHAPTER (Thai Translation)';
        const snippet = ctxText.trim().slice(-800);
        prevChapterContext = `${label} — last part:\n${snippet}\n`;
      }
    }
  }

  return {
    model: document.getElementById('translateModel').value,
    usePolish: document.getElementById('usePolish').checked,
    useMemory: document.getElementById('useMemory').checked,
    temperature: S.currentWs?.settings?.temperature ?? 0.7,
    chunkSize: parseInt(document.getElementById('chunkSize')?.value || '0') || 0,
    customStylePrompt,
    wsGlossary,
    prevChapterContext,
  };
}

// NOTE: This function is dead code — rawInput/translatedOutput elements
// do not exist in HTML. Use startTranslation() instead.
async function translateChapter() {
  const rawContent = document.getElementById('rawInput').value.trim();
  if (!rawContent) return showToast('กรุณาใส่เนื้อหาที่ต้องการแปล', 'error');

  const activeStyle = BUILTIN_STYLES[S.activeStyleId];
  const apiKey = localStorage.getItem('nt8_apikey');
  if (!apiKey) return showToast('ไม่พบ API Key ในระบบ', 'error');

  S.translating = true;
  updateUI();

  const outBox = document.getElementById('translatedOutput');
  outBox.innerHTML = '';
  S.abortCtrl = new AbortController();

  try {
    // [V11 UPDATE] Smart Filtering: เลือกเฉพาะคำศัพท์ที่ปรากฏในเนื้อหาบทนี้
    const relevantGlossary = getSmartGlossary(rawContent, S.glossaryData);

    let glossaryBlock = "";
    if (relevantGlossary.length > 0) {
      const PRONOUN_3RD = { male: '3rd→เขา/ของเขา', female: '3rd→เธอ/นาง/ของเธอ' };
      const PRONOUN_1ST = { male: '1st→ผม/กู/ข้า', female: '1st→ฉัน/หนู/อิฉัน' };
      glossaryBlock = "\n### REQUIRED GLOSSARY (ใช้คำแปลและสรรพนามตามนี้อย่างเคร่งครัด):\n" +
        relevantGlossary.map(g => {
          let line = `- ${g.korean} = ${g.thai}`;
          if (g.type === 'character' && g.gender && g.gender !== 'neutral') {
            line += ` | gender:${g.gender === 'male' ? 'male/ชาย' : 'female/หญิง'}`;
            line += ` | ${PRONOUN_3RD[g.gender]} | ${PRONOUN_1ST[g.gender]}`;
          }
          if (g.note) line += ` [${g.note}]`;
          return line;
        }).join('\n') + "\n";
    }

    const systemPrompt = `${activeStyle.prompt}

THAI PRONOUN RULES — CRITICAL: Male characters → 3rd: เขา/ของเขา, 1st: ผม/กู/ข้า. Female characters → 3rd: เธอ/นาง/ของเธอ, 1st: ฉัน/หนู. NEVER mix genders.
${glossaryBlock}
แปลจากเกาหลีเป็นไทยโดยรักษาสำนวนนิยายและความต่อเนื่องของสรรพนามตามเพศที่ระบุในคำศัพท์`;

    const model = document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash';
    const temperature = S.currentWs?.settings?.temperature ?? 0.7;
    let inTok = 0, outTok = 0;

    await sseStream(
      OPENROUTER_API_URL,
      {
        model,
        temperature,
        max_tokens: Math.max(4000, Math.ceil(rawContent.length * 2)),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawContent },
        ],
      },
      (chunk) => {
        outBox.appendChild(document.createTextNode(chunk));
        if (outBox.scrollHeight - outBox.scrollTop - outBox.clientHeight < 160) {
          outBox.scrollTop = outBox.scrollHeight;
        }
      },
      (i, o) => { inTok = i; outTok = o; },
      S.abortCtrl.signal
    );
    if (inTok || outTok) addCosts(inTok, outTok, model);

    showToast('แปลเสร็จสิ้น ✓', 'success');
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast('หยุดการแปลแล้ว', 'info');
    } else {
      console.error(err);
      showToast('เกิดข้อผิดพลาดในการแปล', 'error');
    }
  } finally {
    S.translating = false;
    S.abortCtrl = null;
    updateUI();
  }
}

function splitText(text) {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [{ index: 0, text }];
  return paragraphs.map((p, i) => ({ index: i, text: p }));
}

function buildGlossaryStr(wsGlossary) {
  const GENDER_MAP   = { male: 'male/ชาย', female: 'female/หญิง', neutral: 'neutral/กลาง' };
  const PRONOUN_3RD  = { male: '3rd→เขา/ของเขา', female: '3rd→เธอ/นาง/ของเธอ' };
  const PRONOUN_1ST  = { male: '1st→ผม/กู/ข้า', female: '1st→ฉัน/หนู/อิฉัน' };
  const entries = Object.entries(wsGlossary || {});
  if (!entries.length) return '(ไม่มี)';
  return entries.map(([k, v]) => {
    const parts = [v.thai];
    if (v.type === 'character' && v.gender && v.gender !== 'neutral') {
      parts.push(`gender:${GENDER_MAP[v.gender] || v.gender}`);
      parts.push(PRONOUN_3RD[v.gender]);
      parts.push(PRONOUN_1ST[v.gender]);
    } else if (v.type === 'character' && v.gender === 'neutral') {
      parts.push('gender:neutral/กลาง');
    }
    if (v.note) parts.push(v.note);
    return `${k} = ${parts.join(' | ')}`;
  }).join('\n');
}

function buildContextStr(segments, currentIndex) {
  if (currentIndex <= 0) return '';
  const prev = segments.slice(Math.max(0, currentIndex - 2), currentIndex);
  const translated = prev.filter(s => s.translation);
  if (!translated.length) return '';
  return `CONTEXT (previous paragraphs):\n${translated.map(s => s.translation).join('\n\n')}\n`;
}

// In-memory cache — LRU, จำกัด 200 entries (~50MB กัน leak)
const _MC_MAX = 200;
const _memoryCache = {};          // key → value
const _memoryCacheOrder = [];     // insertion order สำหรับ LRU eviction

function _mcSet(key, value) {
  if (_memoryCache[key] !== undefined) {
    // refresh position
    const pos = _memoryCacheOrder.indexOf(key);
    if (pos !== -1) _memoryCacheOrder.splice(pos, 1);
  } else if (_memoryCacheOrder.length >= _MC_MAX) {
    // evict oldest
    const oldest = _memoryCacheOrder.shift();
    delete _memoryCache[oldest];
  }
  _memoryCache[key] = value;
  _memoryCacheOrder.push(key);
}

function _mcGet(key) {
  return _memoryCache[key];
}

// ── True SSE streaming per segment ──
// ── core SSE streaming helper ──
async function sseStream(url, body, onChunk, onUsage, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'NovelTrans v10 Pro',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `HTTP ${res.status}`);
  }

  if (!res.body) throw new Error('No response body from API');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', fullText = '', done = false;

  while (!done) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') { done = true; break; }
      try {
        const evt = JSON.parse(raw);
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) { fullText += delta; onChunk(delta); }
        if (evt.usage) onUsage(evt.usage.prompt_tokens||0, evt.usage.completion_tokens||0);
        // finish_reason = stop also means done
        if (evt.choices?.[0]?.finish_reason === 'stop') { done = true; break; }
      } catch {}
    }
  }
  reader.cancel().catch(() => {});
  return fullText;
}

async function streamSegment(text, contextSegs, options, onChunk, onDone) {
  const { model, temperature = 0.7, customStylePrompt, wsGlossary = {}, useMemory = true } = options;
  const cacheKey = text.slice(0, 120);

  if (useMemory && _mcGet(cacheKey)) {
    onChunk(_mcGet(cacheKey));
    onDone(_mcGet(cacheKey), true);
    return;
  }

  const key = getApiKey();
  if (!key) throw new Error('ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า');

  const glossaryStr = buildGlossaryStr(wsGlossary);
  const contextStr = buildContextStr(contextSegs, contextSegs.length);
  const prompt = buildTranslatePrompt({
    sourceText: text,
    glossaryStr,
    contextStr,
    styleNote: customStylePrompt || '',
    ws: null, // streamSegment ไม่ผูกกับ ws ใดๆ (ใช้ literary as default)
  });

  // AbortController with 120s timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);

  let inTok = 0, outTok = 0;
  let fullText = '';
  try {
    fullText = await sseStream(
      OPENROUTER_API_URL,
      { model, temperature, max_tokens: Math.max(2000, Math.ceil(text.length * 2)), messages: [{ role: 'user', content: prompt }] },
      onChunk,
      (i, o) => { inTok = i; outTok = o; },
      ctrl.signal
    );
  } finally {
    clearTimeout(timer);
  }

  if (inTok || outTok) addCosts(inTok, outTok, model);
  if (useMemory && fullText) _mcSet(cacheKey, fullText);
  onDone(fullText, false);
}

// Fallback non-streaming (for preview/polish)
async function translateSegmentDirect(text, allSegments = [], options = {}) {
  const { model = 'google/gemini-2.5-flash', temperature = 0.7, customStylePrompt, wsGlossary = {}, useMemory = true, usePolish = false } = options;
  const cacheKey = text.slice(0, 120);
  if (useMemory && _mcGet(cacheKey)) return { translation: _mcGet(cacheKey), fromMemory: true };

  const glossaryStr = buildGlossaryStr(wsGlossary);
  const contextStr = buildContextStr(allSegments, allSegments.findIndex(s => s.text === text));
  const styleNote = customStylePrompt ? `STYLE GUIDE:\n${customStylePrompt}\n` : '';
  const prompt = TRANSLATE_PROMPT
    .replace('{style_note}', styleNote)
    .replace('{glossary}', glossaryStr)
    .replace('{context}', contextStr)
    .replace('{text}', text);

  const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature, max_tokens: Math.max(2000, Math.ceil(text.length * 2)) });
  let translation = res.choices?.[0]?.message?.content?.trim() || '';

  if (usePolish && translation) {
    const polishPrompt = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', translation);
    try {
      const pr = await callOpenRouter({ model, messages: [{ role: 'user', content: polishPrompt }], temperature: 0.5, max_tokens: Math.max(2000, translation.length * 2) });
      translation = pr.choices?.[0]?.message?.content?.trim() || translation;
    } catch {}
  }
  if (useMemory) _mcSet(cacheKey, translation);
  return { translation, fromMemory: false };
}

async function startTranslation() {
  const rawText = document.getElementById('sourceText').value.trim();
  if (!rawText) { showToast('ใส่ข้อความก่อน', 'error'); return; }
  if (S.translating) return;
  // normalize Korean slang/jamo ก่อนส่ง AI (ไม่แก้ textarea)
  const text = prepareSourceForTranslation(rawText);
  const opts = getOptions();
  if (opts.chunkSize > 0) {
    await translateChunked(text, opts);
  } else {
    await translateAllStream(text);
  }
}

// ─── Auto Extract Glossary หลังแปลเสร็จ ───
// chapterInfo = { id, title, chapterNum } หรือ null ถ้าไม่รู้ตอน
async function autoExtractGlossaryAfterTranslation(sourceText, model, chapterInfo = null, translationText = '') {
  if (!S.currentWsId || !S.currentWs) return;
  if (!sourceText?.trim()) return;
  if (S.currentWs.settings?.autoGlossary === false) return;

  if (!Array.isArray(S.currentWs.glossary)) S.currentWs.glossary = [];

  const existing = S.currentWs.glossary.map(g => g.korean).join(', ') || '(none)';

  // เพิ่ม snippet ของ Thai translation เพื่อช่วย AI detect gender จากสรรพนามไทย
  const thaiSnippet = translationText?.trim()
    ? `THAI TRANSLATION (use Thai pronouns เขา/เธอ/ผม/ฉัน etc. to help infer character gender):\n${translationText.slice(0, 3000)}`
    : '';

  const basePrompt = (() => { try { return agGetPrompt(); } catch { return getAutoGlossaryPrompt(S.currentWs); } })();
  const prompt = basePrompt
    .replace('{existing}', existing)
    .replace('{text}', sourceText.slice(0, 8000))
    .replace('{thai_snippet}', thaiSnippet);

  try {
    const res = await callOpenRouter({
      model: getModelForTask('glossary', S.currentWs) || model || document.getElementById('translateModel')?.value || 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const raw = (res.choices?.[0]?.message?.content || '').trim().replace(/```json|```/g, '').trim();
    let terms;
    try { terms = JSON.parse(raw); }
    catch { terms = tryRepairJson(raw) || []; }

    if (!Array.isArray(terms) || !terms.length) {
      showToast('📖 Auto Glossary: ไม่พบคำศัพท์ใหม่', '');
      return;
    }

    let added = 0;
    terms.forEach(term => {
      if (!term.korean || !term.thai) return;
      const exactExists = S.currentWs.glossary.some(g => g.korean === term.korean);
      if (exactExists) return;
      // แนบ source chapter info ถ้ามี
      const entry = { ...term };
      // sanitize gender — only valid for character type, and must be a known value
      if (entry.type !== 'character' || !['male','female','neutral'].includes(entry.gender)) {
        delete entry.gender;
      }
      if (chapterInfo?.title) {
        entry.sourceChapterId    = chapterInfo.id    || null;
        entry.sourceChapterTitle = chapterInfo.title;
        entry.sourceChapterNum   = chapterInfo.chapterNum || null;
      }
      S.currentWs.glossary.push(entry);
      added++;
    });

    if (added > 0) {
      S.glossaryData = S.currentWs.glossary;
      await lsSaveWorkspace(S.currentWs);
      if (S.currentTab === 'glossary') renderGlossaryTable();
      const chLabel = chapterInfo?.title ? ` (ตอน #${chapterInfo.chapterNum||'?'} ${chapterInfo.title.slice(0,20)})` : '';
      showToast(`📖 Auto Glossary: เพิ่ม ${added} คำใหม่${chLabel} ✓`, 'success');
    } else {
      showToast('📖 Auto Glossary: คำทั้งหมดมีในคลังแล้ว', '');
    }
  } catch (e) {
    showToast(`📖 Auto Glossary ล้มเหลว: ${e.message}`, 'error');
  }
}

function _buildStreamPrompt(text, options) {
  const glossaryStr = buildGlossaryStr(options.wsGlossary);
  const styleNote = options.customStylePrompt || '';
  const storyCtx = ctxGetPromptText(S.currentWs);
  const prevCtx  = (storyCtx ? storyCtx + '\n\n' : '') + (options.prevChapterContext ? `${options.prevChapterContext}\n` : '');
  const preset = getActivePreset(S.currentWs);
  const mtlDraft = preset.id === 'mtlFix'
    ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c?.translation || ''; })()
    : '';
  const prompt = buildTranslatePrompt({ sourceText: text, glossaryStr, contextStr: prevCtx, styleNote, ws: S.currentWs, mtlDraft });
  return { prompt, glossaryStr, preset };
}

async function translateAllStream(text) {
  setTranslating(true);
  clearTranslation();
  showProgress(true);
  setStage('split', 'done');
  setStage('glossary', 'active');
  await new Promise(r => setTimeout(r, 60));
  setStage('glossary', 'done');
  setStage('translate', 'active');

  const output = document.getElementById('translationOutput');
  output.innerHTML = '';

  const options = getOptions();
  const cacheKey = text.slice(0, 120);
  const { prompt, glossaryStr, preset } = _buildStreamPrompt(text, options);

  const key = getApiKey();
  if (!key) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); showProgress(false); return; }

  const doTranslate = async () => {
  output.innerHTML = '';
  const txtEl = document.createElement('div');
  txtEl.className = 'segment-text';
  txtEl.style.whiteSpace = 'pre-wrap';
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  txtEl.appendChild(cursor);
  output.appendChild(txtEl);

  // Check memory
  if (options.useMemory && _mcGet(cacheKey)) {
    cursor.remove();
    txtEl.textContent = _mcGet(cacheKey);
    setStage('translate', 'done'); setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    document.getElementById('translationStats').textContent = 'โหลดจาก Memory ✓';
    showToast('แปลเสร็จสิ้น ✓ (Memory)', 'success');
    return;
  }

  try {
    let charCount = 0;
    S.abortCtrl = new AbortController();
    const timer = setTimeout(() => S.abortCtrl.abort(), 180000);

    let inTok = 0, outTok = 0;
    let fullText = '';

    try {
      fullText = await sseStream(
        OPENROUTER_API_URL,
        { model: options.model, temperature: preset.temperature ?? options.temperature, max_tokens: Math.max(4000, Math.ceil(text.length * 2)), messages: [{ role: 'user', content: prompt }] },
        (delta) => {
          charCount += delta.length;
          fullText += delta;
          if (cursor.parentNode === txtEl) txtEl.insertBefore(document.createTextNode(delta), cursor);
          else txtEl.appendChild(document.createTextNode(delta));
          const est = Math.min(95, Math.round(charCount / Math.max(text.length, 1) * 80));
          updateProgress(est, `กำลังแปล... ${charCount.toLocaleString()} ตัวอักษร`);
          if (output.scrollHeight - output.scrollTop - output.clientHeight < 160) output.scrollTop = output.scrollHeight;
        },
        (i, o) => { inTok = i; outTok = o; },
        S.abortCtrl.signal
      );
    } finally {
      clearTimeout(timer);
    }

    cursor.remove();
    if (inTok || outTok) addCosts(inTok, outTok, options.model);

    if (options.useMemory && fullText) _mcSet(cacheKey, fullText);

    // Optional polish
    if (options.usePolish && fullText) {
      setStage('polish', 'active');
      updateProgress(97, 'Polish...');
      const pp = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', fullText);
      try {
        const pr = await callOpenRouter({ model: options.model, messages: [{ role: 'user', content: pp }], temperature: 0.5, max_tokens: Math.max(4000, fullText.length * 2) });
        const polished = pr.choices?.[0]?.message?.content?.trim();
        if (polished) { fullText = polished; txtEl.textContent = polished; }
      } catch {}
      setStage('polish', 'done');
    }

    setStage('translate', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    document.getElementById('translationStats').textContent = `${fullText.length.toLocaleString()} ตัวอักษร`;
    showToast('แปลเสร็จสิ้น ✓', 'success');
    // ดึง chapter info จาก chapter ที่กำลัง edit อยู่ (ถ้ามี)
    const _streamChInfo = S.editingChapterId
      ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c ? { id: c.id, title: c.title, chapterNum: c.chapterNum } : null; })()
      : null;
    autoExtractGlossaryAfterTranslation(text, options.model, _streamChInfo).catch(e => console.warn('[AutoGlossary]', e));
    // Context Memory: generate summary (non-blocking)
    if (_streamChInfo && fullText) {
      ctxAddSummary(S.currentWs, _streamChInfo.id, _streamChInfo.chapterNum, _streamChInfo.title, fullText)
        .catch(e => console.warn('[CTX]', e));
    }

  } catch (e) {
    cursor.remove();
    if (e.name === 'AbortError') {
      txtEl.textContent = '⬛ ถูกหยุดโดยผู้ใช้';
      updateProgress(0, 'หยุดแล้ว');
      showToast('⬛ หยุดการแปลแล้ว', '');
    } else {
      txtEl.textContent = `❌ ${e.message}`;
      showToast('Error: ' + e.message, 'error');
    }
  }
  }; // end doTranslate

  try {
    await doTranslate();
  } finally {
    setTranslating(false);
    setTimeout(() => showProgress(false), 4000);
  }
}

// ─── Chunk-based translation ───
function splitByChunkSize(text, size) {
  if (!size || size <= 0) return [text];
  const chunks = [];
  // Try to split at natural boundaries (newline) near the chunk boundary
  let pos = 0;
  while (pos < text.length) {
    let end = pos + size;
    if (end >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    // Look for nearest newline within ±20% of chunk size to split cleanly
    const lookBack = Math.floor(size * 0.2);
    const nlPos = text.lastIndexOf('\n', end);
    if (nlPos > pos + size - lookBack) {
      end = nlPos + 1; // split after newline
    } else {
      // No good newline — try space
      const spPos = text.lastIndexOf(' ', end);
      if (spPos > pos + size - lookBack) end = spPos + 1;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks.filter(c => c.trim());
}

async function translateChunked(text, options) {
  setTranslating(true);
  clearTranslation();
  showProgress(true);
  setStage('glossary', 'active');
  await new Promise(r => setTimeout(r, 60));
  setStage('glossary', 'done');
  setStage('translate', 'active');

  const output = document.getElementById('translationOutput');
  output.innerHTML = '';

  const chunks = splitByChunkSize(text, options.chunkSize);
  const n = chunks.length;
  showToast(`แบ่งเป็น ${n} chunk (${options.chunkSize} ตัวอักษร/chunk)`, '');

  const styleNote = options.customStylePrompt ? `STYLE GUIDE:\n${options.customStylePrompt}\n` : '';
  const key = getApiKey();
  if (!key) { showToast('ยังไม่ได้ตั้ง API Key', 'error'); setTranslating(false); showProgress(false); return; }

  let completedTranslations = [];

  try {
    for (let i = 0; i < n; i++) {
      const chunk = chunks[i];
      updateProgress(Math.round(i / n * 100), `chunk ${i+1}/${n} (${chunk.length} ตัวอักษร)`);

      // Smart Glossary: กรองเฉพาะคำที่ปรากฏใน chunk นี้ (ลด token)
      const smartGloss = getSmartGlossary(chunk, S.glossaryData);
      const smartGlossObj = smartGloss.reduce((acc, g) => { acc[g.korean] = { thai: g.thai, type: g.type, note: g.note, gender: g.gender }; return acc; }, {});
      const glossaryStr = buildGlossaryStr(smartGlossObj);

      // Build DOM for this chunk
      const wrapEl = document.createElement('div');
      wrapEl.className = 'translation-segment';

      const idxEl = document.createElement('div');
      idxEl.className = 'segment-index';
      idxEl.innerHTML = `<span>chunk ${i+1}/${n}</span><span class="seg-status active">⚡ กำลังแปล</span>`;

      const txtEl = document.createElement('div');
      txtEl.className = 'segment-text';
      txtEl.style.whiteSpace = 'pre-wrap';

      const cursor = document.createElement('span');
      cursor.className = 'stream-cursor';
      txtEl.appendChild(cursor);

      wrapEl.appendChild(idxEl);
      wrapEl.appendChild(txtEl);
      output.appendChild(wrapEl);
      wrapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      const badge = idxEl.querySelector('.seg-status');

      // Check memory cache
      const cacheKey = chunk.slice(0, 120);
      if (options.useMemory && _mcGet(cacheKey)) {
        cursor.remove();
        txtEl.textContent = _mcGet(cacheKey);
        completedTranslations.push(txtEl.textContent);
        badge.className = 'seg-status cached';
        badge.innerHTML = '📦 Memory';
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);
        continue;
      }

      // Build context from tail of previous translation only (ลด token)
      const prevTail = completedTranslations.length
        ? completedTranslations[completedTranslations.length - 1].slice(-400)
        : '';
      const chunkCtx = prevTail ? `CONTEXT (ท้ายของ chunk ก่อนหน้า):\n${prevTail}\n` : '';
      const _baseCtx = (options.prevChapterContext && !completedTranslations.length)
        ? options.prevChapterContext + '\n' + chunkCtx
        : chunkCtx;
      // Inject story context on first chunk only (ประหยัด token)
      const _storyCtx = !completedTranslations.length ? ctxGetPromptText(S.currentWs) : '';
      const ctxStr = (_storyCtx ? _storyCtx + '\n\n' : '') + _baseCtx;

      const chunkPreset = getActivePreset(S.currentWs);
      const prompt = buildTranslatePrompt({
        sourceText: chunk,
        glossaryStr,
        contextStr: ctxStr,
        styleNote: options.customStylePrompt || '',
        ws: S.currentWs,
      });

      let chunkFull = '';
      let inTok = 0, outTok = 0;

      try {
        // ใช้ global abort + timeout 120s
        S.abortCtrl = new AbortController();
        const timer = setTimeout(() => S.abortCtrl.abort(), 120000);
        try {
          chunkFull = await sseStream(
            OPENROUTER_API_URL,
            { model: options.model, temperature: chunkPreset.temperature ?? options.temperature, max_tokens: Math.max(2000, Math.ceil(chunk.length * 2)), messages: [{ role: 'user', content: prompt }] },
            (delta) => {
              chunkFull += delta;
              if (cursor.parentNode === txtEl) txtEl.insertBefore(document.createTextNode(delta), cursor);
              else txtEl.appendChild(document.createTextNode(delta));
              if (output.scrollHeight - output.scrollTop - output.clientHeight < 160) output.scrollTop = output.scrollHeight;
            },
            (i, o) => { inTok = i; outTok = o; },
            S.abortCtrl.signal
          );
        } finally { clearTimeout(timer); }

        cursor.remove();
        if (inTok || outTok) addCosts(inTok, outTok, options.model);

        if (options.useMemory && chunkFull) _mcSet(cacheKey, chunkFull);
        completedTranslations.push(chunkFull);

        // Polish pass
        if (options.usePolish && chunkFull) {
          badge.className = 'seg-status active';
          badge.textContent = '✨ Polish';
          const pp = POLISH_PROMPT.replace('{glossary}', glossaryStr).replace('{text}', chunkFull);
          try {
            const pr = await callOpenRouter({ model: options.model, messages: [{ role: 'user', content: pp }], temperature: 0.5, max_tokens: Math.max(2000, Math.ceil(chunkFull.length * 1.2)) });
            const polished = pr.choices?.[0]?.message?.content?.trim();
            if (polished) { chunkFull = polished; txtEl.textContent = polished; completedTranslations[completedTranslations.length-1] = polished; }
          } catch {}
        }

        badge.className = 'seg-status done';
        badge.textContent = `✓ ${chunkFull.length} ตัวอักษร`;
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} เสร็จ`);

        // Partial save: บันทึก chunk ที่เสร็จแล้วเข้า chapter ทันที (กัน data loss ถ้าหยุดกลางคัน)
        if (S.editingChapterId && S.currentWs) {
          const _pCh = S.currentWs.chapters?.find(ch => ch.id === S.editingChapterId);
          if (_pCh) {
            _pCh.translation = completedTranslations.join('\n\n');
            _pCh.status = i + 1 < n ? 'partial' : 'translated';
            _pCh.updatedAt = Date.now();
            lsSaveWorkspace(S.currentWs).catch(err => console.error('[Save]', err));
          }
        }

      } catch (err) {
        cursor.remove();
        // ถ้า user กดหยุด → ออกจาก loop ทันที
        if (err.name === 'AbortError') {
          badge.className = 'seg-status error';
          badge.textContent = '⬛ หยุดแล้ว';
          txtEl.textContent = '⬛ ถูกหยุดโดยผู้ใช้';
          updateProgress(Math.round((i+1)/n*100), `หยุดที่ chunk ${i+1}/${n}`);
          break;
        }
        badge.className = 'seg-status error';
        badge.textContent = '✗ Error';
        txtEl.textContent = `❌ ${err.message}`;
        completedTranslations.push('');
        updateProgress(Math.round((i+1)/n*100), `chunk ${i+1}/${n} Error`);
      }
    }

    setStage('translate', 'done');
    if (options.usePolish) setStage('polish', 'done');
    setStage('done', 'done');
    updateProgress(100, 'แปลเสร็จสิ้น ✓');
    const totalChars = completedTranslations.join('').length;
    document.getElementById('translationStats').textContent = `แปลเสร็จ ${n} chunks · ${totalChars.toLocaleString()} ตัวอักษร`;
    showToast(`แปลเสร็จ ${n} chunks ✓`, 'success');

    // ── Auto Extract Glossary ──
    const _chunkChInfo = S.editingChapterId
      ? (() => { const c = S.currentWs?.chapters?.find(ch => ch.id === S.editingChapterId); return c ? { id: c.id, title: c.title, chapterNum: c.chapterNum } : null; })()
      : null;
    const _fullTranslation = completedTranslations.join('\n\n');
    autoExtractGlossaryAfterTranslation(text, options.model, _chunkChInfo, _fullTranslation);
    // Context Memory: generate summary (non-blocking)
    if (_chunkChInfo && _fullTranslation) {
      ctxAddSummary(S.currentWs, _chunkChInfo.id, _chunkChInfo.chapterNum, _chunkChInfo.title, _fullTranslation)
        .catch(e => console.warn('[CTX]', e));
    }

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setTranslating(false);
    setTimeout(() => showProgress(false), 4000);
  }
}

