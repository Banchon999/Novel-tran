'use strict';
// ══════════════════════════════════════════════
// modules/workspace.js — Workspace management, UI init, import/export
// ══════════════════════════════════════════════

// ─── Keyboard Shortcuts ───
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Esc — ปิด modal ที่เปิดอยู่
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-backdrop.open, .modal-backdrop[style*="flex"]');
    if (open) { closeModal(open.id); e.preventDefault(); return; }
  }

  // Ctrl/Cmd + Enter — เริ่มแปล (เฉพาะใน translate tab)
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (S.currentTab === 'translate' && !S.translating) {
      e.preventDefault();
      const translateBtn = document.getElementById('translateBtn') || document.querySelector('[onclick*="startTranslation"]');
      if (translateBtn && !translateBtn.disabled) translateBtn.click();
    }
    return;
  }

  // Ctrl/Cmd + S — บันทึก chapter (เมื่อ modal-view-chapter เปิด)
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const chModal = document.getElementById('modal-view-chapter');
    if (chModal && (chModal.classList.contains('open') || chModal.style.display !== 'none')) {
      e.preventDefault();
      saveChapter();
    }
    return;
  }

  // Ctrl/Cmd + F — focus search (ใน chapters/glossary tab)
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isInput) {
    const searchBox = S.currentTab === 'glossary'
      ? document.getElementById('glossarySearch')
      : document.getElementById('chapterSearch');
    if (searchBox) { e.preventDefault(); searchBox.focus(); searchBox.select(); }
  }
});

// ════════════════════ INIT / UI ════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Load costs (still in localStorage — tiny)
  try { S.costs = JSON.parse(localStorage.getItem(LS_KEY_COSTS)) || S.costs; } catch {}
  updateCostUI();
  checkHealth();
  renderBuiltinStyles();
  refreshModelSelects(); // inject custom models into all selects at startup
  document.getElementById('sourceText').addEventListener('input', updateSourceStats);

  // Migrate old localStorage data → IndexedDB (runs once)
  await migrateFromLocalStorage();

  await loadWorkspaceList();

  const lastWs = await getLastWs();
  if (lastWs) await selectWorkspace(lastWs);

  checkBackupReminderOnLoad();
});

// ─── Health ───
function checkHealth() {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const key = getApiKey();
  if (key) {
    dot.className = 'status-dot ok';
    txt.textContent = 'API Key พร้อมใช้';
  } else {
    dot.className = 'status-dot error';
    txt.textContent = 'ยังไม่ได้ตั้ง API Key';
  }
}

// ─── Sidebar ───
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// ─── Workspace List ───
async function loadWorkspaceList() {
  const list = await lsGetWorkspaceList();
  S.wsList = list; // track for backup reminder
  const el = document.getElementById('wsList');
  if (!list.length) {
    el.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:6px 0">ยังไม่มี Workspace</div>';
    return;
  }
  el.innerHTML = list.map(w => `
    <div class="ws-item ${S.currentWsId === w.id ? 'active' : ''}" onclick="selectWorkspace('${w.id}')">
      <span class="ws-emoji">${w.emoji || '📖'}</span>
      <div class="ws-info">
        <div class="ws-name">${esc(w.name)}</div>
        <div class="ws-meta">${w.chapterCount || 0} ตอน</div>
      </div>
    </div>
  `).join('');
}

async function selectWorkspace(id) {
  const ws = await lsGetWorkspace(id);
  if (!ws) { showToast('ไม่พบ Workspace', 'error'); return; }
  S.currentWsId = id;
  S.currentWs = ws;
  S.glossaryData = ws.glossary || [];
  await setLastWs(id);

  document.getElementById('noWsMsg').style.display = 'none';
  document.getElementById('wsContent').className = 'ws-content-visible';
  document.getElementById('wsNameHeader').textContent = `${ws.emoji || '📖'} ${ws.name}`;

  const model = ws.settings?.translateModel || 'deepseek/deepseek-chat';
  document.getElementById('translateModel').value = model;

  // Restore custom activeStyleId from workspace settings
  const savedStyle = ws.settings?.activeStyleId;
  if (savedStyle) {
    const validBuiltin = !!BUILTIN_STYLES[savedStyle];
    const validCustom = (ws.customStyles || []).some(s => s.id === savedStyle);
    if (validBuiltin || validCustom) S.activeStyleId = savedStyle;
    else S.activeStyleId = 'natural';
  } else {
    S.activeStyleId = 'natural';
  }

  await loadWorkspaceList();
  // reset bulk mode เมื่อเปลี่ยน workspace
  _bulkMode = false;
  const bdb = document.getElementById('bulkDeleteBar');
  const bme = document.getElementById('bulkModeEntryBar');
  if (bdb) bdb.style.display = 'none';
  if (bme) bme.style.display = 'flex';
  refreshModelSelects();
  updateLangUI(ws);
  renderCurrentTab();
  updateChapterSaveSelect();
  renderStyleSelect();
  closeSidebar();
}

// ─── Tab Switching ───
function switchTab(tab) {
  S.currentTab = tab;
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).style.display = 'flex';
  renderCurrentTab();
}

function renderCurrentTab() {
  switch (S.currentTab) {
    case 'chapters': renderChapters(); break;
    case 'glossary': renderGlossaryTable(); break;
    case 'styles': renderStyles(); break;
    case 'settings-ws': renderWsSettings(); break;
  }
}

// ─── Create Workspace ───
async function createWorkspace() {
  const name = document.getElementById('newWsName').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อนิยาย', 'error'); return; }
  const ws = {
    id: genId(),
    name,
    emoji: document.getElementById('newWsEmoji').value.trim() || '📖',
    description: document.getElementById('newWsDesc').value.trim(),
    chapters: [],
    glossary: [],
    customStyles: [],
    settings: { translateModel: 'deepseek/deepseek-chat', temperature: 0.7 },
    createdAt: Date.now(),
  };
  await lsSaveWorkspace(ws);
  closeModal('modal-new-ws');
  document.getElementById('newWsName').value = '';
  document.getElementById('newWsEmoji').value = '';
  document.getElementById('newWsDesc').value = '';
  await selectWorkspace(ws.id);
  showToast(`สร้าง "${name}" สำเร็จ`, 'success');
}

async function deleteCurrentWorkspace() {
  if (!S.currentWsId) return;
  if (!confirm(`ลบ "${S.currentWs?.name}" ทั้งหมด? ไม่สามารถกู้คืนได้`)) return;
  await lsDeleteWorkspace(S.currentWsId);
  S.currentWsId = null; S.currentWs = null;
  await clearLastWs();
  document.getElementById('noWsMsg').style.display = 'flex';
  document.getElementById('wsContent').className = 'ws-content-hidden';
  document.getElementById('wsNameHeader').textContent = '—';
  await loadWorkspaceList();
  showToast('ลบ Workspace แล้ว', '');
}

// ─── Workspace Settings ───
function renderWsSettings() {
  if (!S.currentWs) return;
  const w = S.currentWs;
  document.getElementById('wsEditName').value = w.name || '';
  document.getElementById('wsEditDesc').value = w.description || '';
  document.getElementById('wsEditEmoji').value = w.emoji || '📖';
  document.getElementById('wsTranslateModel').value = w.settings?.translateModel || 'deepseek/deepseek-chat';
  const temp = w.settings?.temperature ?? 0.7;
  document.getElementById('wsTemp').value = temp;
  document.getElementById('wsTempVal').textContent = temp;
  const autoGlossary = w.settings?.autoGlossary !== false;
  document.getElementById('wsAutoGlossary').checked = autoGlossary;
  const presetSel = document.getElementById('wsPresetSelect');
  if (presetSel) presetSel.value = w.presetId || 'literary';
  // Language settings
  const srcSel = document.getElementById('wsSourceLang');
  const tgtSel = document.getElementById('wsTargetLang');
  if (srcSel) srcSel.value = w.settings?.sourceLang || 'ko';
  if (tgtSel) tgtSel.value = w.settings?.targetLang || 'th';
  // Context Memory settings
  const ctx = wsGetContext(w);
  const ctxEnabledEl  = document.getElementById('wsCtxEnabled');
  const ctxOptionsEl  = document.getElementById('wsCtxOptions');
  const ctxMaxTokEl   = document.getElementById('wsCtxMaxTokens');
  if (ctxEnabledEl)  ctxEnabledEl.checked = ctx.enabled;
  if (ctxOptionsEl)  ctxOptionsEl.style.display = ctx.enabled ? 'block' : 'none';
  if (ctxMaxTokEl)   ctxMaxTokEl.value = String(ctx.maxTokens || 1500);
  ctxUpdateStatusBadge(w);
  // Custom models & task assignments
  renderCustomModels();
  renderTaskModelAssignment(w);
}

async function saveWsSettings() {
  if (!S.currentWsId) return;
  S.currentWs.name = document.getElementById('wsEditName').value.trim();
  S.currentWs.description = document.getElementById('wsEditDesc').value.trim();
  S.currentWs.emoji = document.getElementById('wsEditEmoji').value.trim() || '📖';

  // Collect task model roles from select elements
  const TASKS = ['translate', 'polish', 'glossary', 'qa', 'summary'];
  const modelRoles = {};
  TASKS.forEach(t => {
    const el = document.getElementById(`wsRole_${t}`);
    if (el) modelRoles[t] = el.value;
  });

  S.currentWs.settings = {
    ...(S.currentWs.settings || {}),
    translateModel: document.getElementById('wsTranslateModel').value,
    temperature:    parseFloat(document.getElementById('wsTemp').value),
    autoGlossary:   document.getElementById('wsAutoGlossary').checked,
    sourceLang:     document.getElementById('wsSourceLang')?.value || 'ko',
    targetLang:     document.getElementById('wsTargetLang')?.value || 'th',
    modelRoles,
  };
  const presetSel = document.getElementById('wsPresetSelect');
  if (presetSel) S.currentWs.presetId = presetSel.value || 'literary';
  await lsSaveWorkspace(S.currentWs);
  document.getElementById('wsNameHeader').textContent = `${S.currentWs.emoji} ${S.currentWs.name}`;
  await loadWorkspaceList();
  updateLangUI(S.currentWs);
  showToast('บันทึกแล้ว ✓', 'success');
}

// ─── Export / Import ───
async function exportWorkspaceJSON() {
  if (!S.currentWs) return;
  const blob = new Blob([JSON.stringify(S.currentWs, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${S.currentWs.name}_noveltrans.json`);
  _markBackupDone();
  showToast('Export JSON สำเร็จ', 'success');
}

// Export ALL workspaces in one file
async function exportAllWorkspacesJSON() {
  const list = await lsGetWorkspaceList();
  if (!list.length) { showToast('ไม่มี Workspace', 'error'); return; }
  const all = [];
  for (const meta of list) {
    const ws = await lsGetWorkspace(meta.id);
    if (ws) all.push(ws);
  }
  const ts   = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), workspaces: all }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `NovelTrans_ALL_${ts}.json`);
  _markBackupDone();
  showToast(`Export สำเร็จ ${all.length} Workspace ✓`, 'success');
}

// ── Backup reminder system ──
const LS_LAST_BACKUP = 'nt8_last_backup_ts';
const BACKUP_WARN_HOURS = 12; // warn after 12h without backup

function _markBackupDone() {
  localStorage.setItem(LS_LAST_BACKUP, String(Date.now()));
  _updateBackupWarning();
}

function _getLastBackupTs() {
  return parseInt(localStorage.getItem(LS_LAST_BACKUP) || '0', 10);
}

function _updateBackupWarning() {
  const el = document.getElementById('backupWarnBar');
  if (!el) return;
  const ts   = _getLastBackupTs();
  const age  = (Date.now() - ts) / 3600000; // hours
  const list = S.wsList || [];
  if (!list.length) { el.style.display = 'none'; return; }

  if (ts === 0) {
    el.style.display = 'flex';
    el.innerHTML = `⚠ ยังไม่เคย Backup — ข้อมูลอาจหายถ้าเบราว์เซอร์ล้างข้อมูล &nbsp;<button class="btn-xs" onclick="exportAllWorkspacesJSON()" style="background:var(--gold);color:#000;font-weight:600">💾 Backup ทันที</button>`;
  } else if (age > BACKUP_WARN_HOURS) {
    const h = Math.floor(age);
    el.style.display = 'flex';
    el.innerHTML = `⚠ Backup ครั้งล่าสุด ${h} ชั่วโมงที่แล้ว &nbsp;<button class="btn-xs" onclick="exportAllWorkspacesJSON()" style="background:var(--gold);color:#000;font-weight:600">💾 Backup ทันที</button> <button class="btn-xs" onclick="document.getElementById('backupWarnBar').style.display='none'" style="margin-left:4px;opacity:0.6">✕</button>`;
  } else {
    el.style.display = 'none';
  }
}

async function checkBackupReminderOnLoad() {
  // Give it a moment for workspace list to load
  await new Promise(r => setTimeout(r, 1000));
  _updateBackupWarning();
}

// Warn before closing tab if backup overdue > 24h
window.addEventListener('beforeunload', (e) => {
  const ts  = _getLastBackupTs();
  const age = (Date.now() - ts) / 3600000;
  if ((ts === 0 || age > 24) && (S.wsList?.length > 0)) {
    e.preventDefault();
    e.returnValue = 'ยังไม่ได้ Backup Workspace — ต้องการออกใช่ไหม?';
  }
});

// ─── Glossary Inheritance (import from another WS) ───
async function openGlossaryInherit() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const list = await lsGetWorkspaceList();
  const sel = document.getElementById('inheritWsSelect');
  sel.innerHTML = '<option value="">— เลือก Workspace —</option>' +
    list.filter(w => w.id !== S.currentWsId)
        .map(w => `<option value="${w.id}">${esc(w.emoji || '📖')} ${esc(w.name)} (${w.chapterCount || 0} ตอน)</option>`)
        .join('');
  document.getElementById('inheritPreviewInfo').textContent = '';
  openModal('modal-glossary-inherit');
}

async function previewInheritGlossary() {
  const id = document.getElementById('inheritWsSelect').value;
  if (!id) { document.getElementById('inheritPreviewInfo').textContent = ''; return; }
  const ws = await lsGetWorkspace(id);
  if (!ws) return;
  const total = ws.glossary?.length || 0;
  const newTerms = (ws.glossary || []).filter(g => !S.currentWs.glossary.some(x => x.korean === g.korean)).length;
  document.getElementById('inheritPreviewInfo').textContent =
    `${total} คำใน WS นั้น — ใหม่ที่จะ import: ${newTerms} คำ`;
}

async function confirmInheritGlossary() {
  const id = document.getElementById('inheritWsSelect').value;
  if (!id) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const ws = await lsGetWorkspace(id);
  if (!ws?.glossary?.length) { showToast('Workspace นั้นไม่มีคลังศัพท์', 'error'); return; }
  const skipDup   = document.getElementById('inheritSkipDup').checked;
  const charsOnly = document.getElementById('inheritCharsOnly').checked;
  let added = 0;
  for (const g of ws.glossary) {
    if (charsOnly && g.type !== 'character') continue;
    if (skipDup && S.currentWs.glossary.some(x => x.korean === g.korean)) continue;
    S.currentWs.glossary.push({ ...g });
    added++;
  }
  if (!added) { showToast('ไม่มีคำใหม่ที่จะ import', ''); return; }
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  closeModal('modal-glossary-inherit');
  showToast(`Import ${added} คำจาก "${ws.name}" สำเร็จ ✓`, 'success');
}

// ─── Glossary CSV Import ───
const VALID_TYPES = new Set(['character','title','rank','term','honorific','place','skill','item','clan','monster']);
const VALID_GENDERS = new Set(['male','female','neutral']);
let _csvPendingRows = [];

function openGlossaryCSVImport() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  document.getElementById('glossaryCsvFile').click();
}

function handleGlossaryCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    _csvPendingRows = parseGlossaryCSV(text);
    renderCSVPreview(_csvPendingRows);
    openModal('modal-glossary-csv-import');
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

function parseGlossaryCSV(text) {
  // รองรับ CSV, TSV, และตัวคั่นอื่นๆ
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  // Auto-detect delimiter
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const rows = [];
  // ข้ามบรรทัดแรก (header) ถ้ามี Korean/korean/เกาหลี
  const firstLow = lines[0].toLowerCase();
  const startIdx = (firstLow.includes('korean') || firstLow.includes('เกาหลี') || firstLow.includes('kr')) ? 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delim);
    const korean = (cols[0] || '').trim();
    const thai   = (cols[1] || '').trim();
    if (!korean || !thai) continue;
    const rawType   = (cols[2] || '').trim().toLowerCase();
    const rawGender = (cols[3] || '').trim().toLowerCase();
    const note      = (cols[4] || '').trim();
    const type   = VALID_TYPES.has(rawType)   ? rawType   : 'term';
    const gender = VALID_GENDERS.has(rawGender) ? rawGender : '';
    const exists = S.currentWs.glossary.some(g => g.korean === korean);
    rows.push({ korean, thai, type, gender, note, exists, selected: !exists });
  }
  return rows;
}

function splitCSVLine(line, delim) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === delim && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

function renderCSVPreview(rows) {
  const tbody = document.getElementById('csvPreviewBody');
  const newRows  = rows.filter(r => !r.exists).length;
  const dupRows  = rows.filter(r => r.exists).length;
  document.getElementById('csvImportStats').textContent =
    `พบ ${rows.length} รายการ — ใหม่: ${newRows} | ซ้ำ (ข้ามอัตโนมัติ): ${dupRows}`;
  tbody.innerHTML = rows.map((r, idx) => `
    <tr style="opacity:${r.exists ? 0.45 : 1}">
      <td style="padding:4px 8px">${esc(r.korean)}</td>
      <td style="padding:4px 8px">${esc(r.thai)}</td>
      <td style="padding:4px 8px">${esc(r.type)}</td>
      <td style="padding:4px 8px">${esc(r.gender)}</td>
      <td style="padding:4px 8px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(r.note)}</td>
      <td style="padding:4px 8px">
        ${r.exists
          ? '<span style="color:var(--text-muted)">ซ้ำ</span>'
          : `<input type="checkbox" data-idx="${idx}" ${r.selected ? 'checked' : ''} onchange="_csvToggle(${idx},this.checked)">`}
      </td>
    </tr>
  `).join('');
}

function _csvToggle(idx, val) { _csvPendingRows[idx].selected = val; }

async function confirmGlossaryCSVImport() {
  const toAdd = _csvPendingRows.filter(r => r.selected && !r.exists);
  if (!toAdd.length) { showToast('ไม่มีรายการที่จะ import', 'error'); return; }
  toAdd.forEach(r => {
    const entry = { korean: r.korean, thai: r.thai, type: r.type, note: r.note };
    if (r.type === 'character' && r.gender) entry.gender = r.gender;
    S.currentWs.glossary.push(entry);
  });
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  closeModal('modal-glossary-csv-import');
  showToast(`Import สำเร็จ: เพิ่ม ${toAdd.length} คำ ✓`, 'success');
}

// ─── Multi-Workspace Export ───
async function openMultiExport() {
  const list = await lsGetWorkspaceList();
  if (!list.length) { showToast('ไม่มี Workspace', 'error'); return; }
  const container = document.getElementById('multiExportList');
  container.innerHTML = list.map(w => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;background:var(--bg-card);border:1px solid var(--border)">
      <input type="checkbox" class="multi-exp-chk" data-id="${w.id}" checked style="width:16px;height:16px;cursor:pointer">
      <span style="font-size:1.1rem">${w.emoji || '📖'}</span>
      <span style="flex:1;font-size:0.88rem">${esc(w.name)}</span>
      <span style="font-size:0.75rem;color:var(--text-muted)">${w.chapterCount || 0} ตอน</span>
    </label>
  `).join('');
  container.querySelectorAll('.multi-exp-chk').forEach(cb => cb.addEventListener('change', multiExportUpdateCount));
  multiExportUpdateCount();
  openModal('modal-multi-export');
}

function multiExportSelectAll(val) {
  document.querySelectorAll('.multi-exp-chk').forEach(cb => { cb.checked = val; });
  multiExportUpdateCount();
}

function multiExportUpdateCount() {
  const n = document.querySelectorAll('.multi-exp-chk:checked').length;
  document.getElementById('multiExportCount').textContent = `${n} Workspace ที่เลือก`;
}

async function doMultiExport() {
  const checked = [...document.querySelectorAll('.multi-exp-chk:checked')];
  if (!checked.length) { showToast('เลือก Workspace ก่อน', 'error'); return; }

  showToast(`กำลังโหลด ${checked.length} Workspace...`, '');
  const workspaces = [];
  for (const cb of checked) {
    const ws = await lsGetWorkspace(cb.dataset.id);
    if (ws) workspaces.push(ws);
  }

  const bundle = {
    _format: 'noveltrans-multi-export',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    _count: workspaces.length,
    workspaces,
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `noveltrans_backup_${date}_${workspaces.length}ws.json`);
  _markBackupDone();
  closeModal('modal-multi-export');
  showToast(`Export ${workspaces.length} Workspace สำเร็จ ✓`, 'success');
}

function openImportWs() { document.getElementById('importWsFile').click(); }

async function importWorkspace(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      parsed = tryRepairJson(text);
      if (!parsed) throw new Error(`JSON เสียหาย (${parseErr.message})`);
      showToast('⚠ JSON ถูกซ่อมแซมบางส่วน ข้อมูลอาจไม่ครบ', 'error');
    }

    // ─ Multi-export bundle ─
    if (parsed?._format === 'noveltrans-multi-export' && Array.isArray(parsed.workspaces)) {
      let imported = 0;
      for (const ws of parsed.workspaces) {
        if (!ws.id || !ws.name) continue;
        if (!ws.chapters) ws.chapters = [];
        if (!ws.glossary) ws.glossary = [];
        if (!ws.customStyles) ws.customStyles = [];
        if (!ws.settings) ws.settings = {};
        await lsSaveWorkspace(ws);
        imported++;
      }
      await loadWorkspaceList();
      showToast(`Import Bundle สำเร็จ: ${imported} Workspace ✓`, 'success');
      e.target.value = '';
      return;
    }

    // ─ Single workspace ─
    const ws = parsed;
    if (!ws.id || !ws.name) throw new Error('ไฟล์ไม่ถูกต้อง — ไม่พบ id หรือ name');
    if (!ws.chapters) ws.chapters = [];
    if (!ws.glossary) ws.glossary = [];
    if (!ws.customStyles) ws.customStyles = [];
    if (!ws.settings) ws.settings = {};
    await lsSaveWorkspace(ws);
    await selectWorkspace(ws.id);
    showToast(`Import "${ws.name}" สำเร็จ (${ws.chapters.length} ตอน)`, 'success');
  } catch (err) {
    showToast('Import ล้มเหลว: ' + err.message, 'error');
  }
  e.target.value = '';
}

// ── Attempt to repair truncated JSON by closing unclosed brackets/braces ──
function tryRepairJson(text) {
  let t = text.trimEnd().replace(/,\s*$/, ''); // strip trailing comma
  const stack = [];
  let inStr = false, escape = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"' && !escape) { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') stack.pop();
    }
  }
  if (!stack.length) return null;
  const closing = stack.reverse().map(c => c === '{' ? '}' : ']').join('');
  try { return JSON.parse(t + closing); } catch { return null; }
}
