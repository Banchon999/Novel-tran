'use strict';
// ══════════════════════════════════════════════
// modules/chapters.js — Chapter management, Glossary CRUD, Split/Merge
// ══════════════════════════════════════════════
// ════════════════════ CHAPTERS ════════════════════
let _bulkMode = false;

function enterBulkMode() {
  _bulkMode = true;
  document.getElementById('bulkDeleteBar').style.display = 'flex';
  document.getElementById('bulkModeEntryBar').style.display = 'none';
  document.getElementById('chkSelectAll').checked = false;
  renderChapters();
  updateBulkCount();
}

function exitBulkMode() {
  _bulkMode = false;
  document.getElementById('bulkDeleteBar').style.display = 'none';
  document.getElementById('bulkModeEntryBar').style.display = 'flex';
  document.getElementById('chkSelectAll').checked = false;
  renderChapters();
}

function updateBulkCount() {
  const n = document.querySelectorAll('.ch-chk:checked').length;
  document.getElementById('bulkDeleteCount').textContent = `${n} ตอนที่เลือก`;
}

function chSelectAll(checked) {
  document.querySelectorAll('.ch-chk').forEach(el => el.checked = checked);
  updateBulkCount();
}

function chSelectPending() {
  document.querySelectorAll('.ch-chk').forEach(el => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status !== 'translated';
  });
  updateBulkCount();
}

function chSelectTranslated() {
  document.querySelectorAll('.ch-chk').forEach(el => {
    const ch = S.currentWs?.chapters.find(c => c.id === el.dataset.id);
    el.checked = ch?.status === 'translated';
  });
  updateBulkCount();
}

async function deleteSelectedChapters() {
  const checked = [...document.querySelectorAll('.ch-chk:checked')];
  if (!checked.length) { showToast('ยังไม่ได้เลือกตอน', 'error'); return; }
  if (!confirm(`ลบ ${checked.length} ตอนที่เลือก?\nไม่สามารถกู้คืนได้`)) return;
  const ids = new Set(checked.map(el => el.dataset.id));
  S.currentWs.chapters = S.currentWs.chapters.filter(ch => !ids.has(ch.id));
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  updateBulkCount();
  document.getElementById('chkSelectAll').checked = false;
  showToast(`ลบ ${ids.size} ตอนแล้ว ✓`, 'success');
}

// ─── Range Select helper (Shift+click) ───
// ใช้ร่วมกันทุก list — เก็บ lastIndex ต่อ "group"
const _lastCheckedIdx = {};

function rangeCheckboxClick(e, groupKey, checkboxSelector, onAfter) {
  const allBoxes = [...document.querySelectorAll(checkboxSelector)];
  const idx = allBoxes.indexOf(e.target);
  if (idx < 0) return;

  if (e.shiftKey && _lastCheckedIdx[groupKey] !== undefined) {
    const from = Math.min(_lastCheckedIdx[groupKey], idx);
    const to   = Math.max(_lastCheckedIdx[groupKey], idx);
    const targetState = e.target.checked;
    for (let i = from; i <= to; i++) {
      allBoxes[i].checked = targetState;
    }
  }
  _lastCheckedIdx[groupKey] = idx;
  if (onAfter) onAfter();
}

function renderChapters() {
  const list = document.getElementById('chapterList');
  const chapters = S.currentWs?.chapters || [];
  const searchTerm = document.getElementById('chapterSearch')?.value?.trim().toLowerCase() || '';
  const filtered = searchTerm
    ? chapters.filter(ch => ch.title.toLowerCase().includes(searchTerm) || String(ch.chapterNum).includes(searchTerm))
    : chapters;
  document.getElementById('chapterCount').textContent = searchTerm
    ? `${filtered.length}/${chapters.length} ตอน`
    : `${chapters.length} ตอน`;
  if (!filtered.length) {
    list.innerHTML = chapters.length
      ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:0.85rem">ไม่พบตอนที่ตรงกับคำค้นหา</div>'
      : '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:0.85rem">ยังไม่มีตอน — กด ＋ เพิ่มตอน</div>';
    return;
  }
  list.innerHTML = [...filtered]
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
    .map(ch => `
      <div class="chapter-card${_bulkMode ? ' bulk-mode' : ''}" onclick="${_bulkMode ? `chToggle('${ch.id}')` : `openChapter('${ch.id}')`}">
        ${_bulkMode ? `<input type="checkbox" class="ch-chk" data-id="${ch.id}" style="accent-color:var(--gold);flex-shrink:0;width:16px;height:16px" onclick="event.stopPropagation();rangeCheckboxClick(event,'ch-bulk','.ch-chk',updateBulkCount)" onchange="updateBulkCount()" title="Shift+คลิก เพื่อเลือกช่วง"/>` : ''}
        <div class="ch-num">#${ch.chapterNum || '?'}</div>
        <div class="ch-info">
          <div class="ch-title">${esc(ch.title)}${ch.glossaryExtracted ? '<span class="ch-glossary-badge">📖 Glossary</span>' : ''}</div>
          <div class="ch-meta">${ch.updatedAt ? new Date(ch.updatedAt).toLocaleDateString('th-TH') : ''} ${ch.wordCount ? `· ${ch.wordCount.toLocaleString()} ตัวอักษร` : ''}</div>
        </div>
        <div class="ch-status">
          <span class="status-badge ${ch.status === 'translated' ? 'translated' : 'pending'}">
            ${ch.status === 'translated' ? '✓ แปลแล้ว' : '○ รอแปล'}
          </span>
        </div>
      </div>
    `).join('');
}

function chToggle(id) {
  const chk = document.querySelector(`.ch-chk[data-id="${id}"]`);
  if (chk) { chk.checked = !chk.checked; updateBulkCount(); }
}

async function addChapter() {
  const title = document.getElementById('newChTitle').value.trim();
  if (!title) { showToast('ใส่ชื่อตอนก่อน', 'error'); return; }
  const ch = {
    id: genId(),
    title,
    chapterNum: parseInt(document.getElementById('newChNum').value) || (S.currentWs.chapters.length + 1),
    notes: document.getElementById('newChNotes').value.trim(),
    sourceText: '', translation: '',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  S.currentWs.chapters.push(ch);
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-new-chapter');
  document.getElementById('newChTitle').value = '';
  document.getElementById('newChNum').value = '';
  document.getElementById('newChNotes').value = '';
  renderChapters();
  updateChapterSaveSelect();
  showToast(`เพิ่ม "${title}" แล้ว`, 'success');
}

function openChapter(id) {
  const ch = S.currentWs?.chapters.find(c => c.id === id);
  if (!ch) return;
  S.editingChapterId = id;
  document.getElementById('viewChTitle').textContent = `#${ch.chapterNum || '?'} ${ch.title}`;
  document.getElementById('viewChSource').value = ch.sourceText || '';
  document.getElementById('viewChTranslation').value = ch.translation || '';
  document.getElementById('viewChNotes').value = ch.notes || '';
  _updateChapterNav();
  openModal('modal-view-chapter');
}

function _getSortedChapters() {
  return [...(S.currentWs?.chapters || [])].sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0));
}

function _updateChapterNav() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const total = sorted.length;
  const navLabel = document.getElementById('viewChNavLabel');
  const prevBtn  = document.getElementById('viewChPrevBtn');
  const nextBtn  = document.getElementById('viewChNextBtn');
  if (!navLabel || !prevBtn || !nextBtn) return;
  navLabel.textContent = total > 0 ? `ตอนที่ ${idx + 1} / ${total}` : '';
  prevBtn.disabled = idx <= 0;
  prevBtn.style.opacity = idx <= 0 ? '0.35' : '1';
  nextBtn.disabled = idx >= total - 1;
  nextBtn.style.opacity = idx >= total - 1 ? '0.35' : '1';
}

async function navigateChapter(dir) {
  // Auto-save before navigating
  if (S.editingChapterId) {
    const cur = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
    if (cur) {
      cur.sourceText  = document.getElementById('viewChSource').value;
      cur.translation = document.getElementById('viewChTranslation').value;
      cur.notes       = document.getElementById('viewChNotes').value;
      cur.status      = cur.translation ? 'translated' : 'pending';
      cur.wordCount   = cur.translation.length;
      cur.updatedAt   = Date.now();
      await lsSaveWorkspace(S.currentWs);
      renderChapters();
    }
  }
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const next = sorted[idx + dir];
  if (!next) return;
  S.editingChapterId = next.id;
  document.getElementById('viewChTitle').textContent = `#${next.chapterNum || '?'} ${next.title}`;
  document.getElementById('viewChSource').value = next.sourceText || '';
  document.getElementById('viewChTranslation').value = next.translation || '';
  document.getElementById('viewChNotes').value = next.notes || '';
  _updateChapterNav();
}

async function saveChapter() {
  if (!S.editingChapterId) return;
  const ch = S.currentWs.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  ch.sourceText = document.getElementById('viewChSource').value;
  ch.translation = document.getElementById('viewChTranslation').value;
  ch.notes = document.getElementById('viewChNotes').value;
  ch.status = ch.translation ? 'translated' : 'pending';
  ch.wordCount = ch.translation.length;
  ch.updatedAt = Date.now();
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  showToast('บันทึกตอนแล้ว ✓', 'success');
}

async function deleteCurrentChapter() {
  if (!S.editingChapterId || !confirm('ลบตอนนี้?')) return;
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  // Undo snapshot
  const deletedCh = S.currentWs.chapters.find(c => c.id === S.editingChapterId);
  S._undoStack = { type: 'delete_chapter', chapter: JSON.parse(JSON.stringify(deletedCh)) };
  S.currentWs.chapters = S.currentWs.chapters.filter(c => c.id !== S.editingChapterId);
  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  showToast('ลบตอนแล้ว — <u style="cursor:pointer" onclick="undoLastAction()">Undo</u>', '');
  const newSorted = _getSortedChapters();
  if (newSorted.length) {
    const next = newSorted[Math.min(idx, newSorted.length - 1)];
    S.editingChapterId = next.id;
    document.getElementById('viewChTitle').textContent = `#${next.chapterNum || '?'} ${next.title}`;
    document.getElementById('viewChSource').value = next.sourceText || '';
    document.getElementById('viewChTranslation').value = next.translation || '';
    document.getElementById('viewChNotes').value = next.notes || '';
    _updateChapterNav();
  } else {
    closeModal('modal-view-chapter');
  }
}

async function undoLastAction() {
  const action = S._undoStack;
  if (!action) { showToast('ไม่มีอะไรให้ Undo', ''); return; }
  S._undoStack = null;

  if (action.type === 'delete_chapter') {
    const ch = action.chapter;
    // Re-insert; avoid duplicate id
    if (!S.currentWs.chapters.find(c => c.id === ch.id)) {
      S.currentWs.chapters.push(ch);
    }
    // Renumber by current order
    [...S.currentWs.chapters]
      .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
      .forEach((c, i) => { c.chapterNum = i + 1; });
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    updateChapterSaveSelect();
    // Open the restored chapter
    S.editingChapterId = ch.id;
    document.getElementById('viewChTitle').textContent = `#${ch.chapterNum || '?'} ${ch.title}`;
    document.getElementById('viewChSource').value = ch.sourceText || '';
    document.getElementById('viewChTranslation').value = ch.translation || '';
    document.getElementById('viewChNotes').value = ch.notes || '';
    _updateChapterNav();
    openModal('modal-view-chapter');
    showToast('↩ Undo: คืนตอนที่ลบแล้ว', 'success');

  } else if (action.type === 'clean_all_source') {
    for (const snap of action.snapshot) {
      const ch = S.currentWs.chapters.find(c => c.id === snap.id);
      if (ch) ch.sourceText = snap.sourceText;
    }
    await lsSaveWorkspace(S.currentWs);
    renderChapters();
    // Refresh open chapter view if applicable
    if (S.editingChapterId) {
      const ch = S.currentWs.chapters.find(c => c.id === S.editingChapterId);
      if (ch) document.getElementById('viewChSource').value = ch.sourceText || '';
    }
    showToast('↩ Undo: คืน Source Text ทุกตอนแล้ว', 'success');
  }
}

function loadChapterToTranslate() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  document.getElementById('sourceText').value = ch.sourceText || '';
  updateSourceStats();
  closeModal('modal-view-chapter');
  switchTab('translate');
  showToast(`โหลด "${ch.title}" แล้ว`, 'success');
}

function updateChapterSaveSelect() {
  const sel = document.getElementById('chapterSaveTarget');
  const chapters = S.currentWs?.chapters || [];
  sel.innerHTML = `<option value="">— บันทึกลงตอน —</option>` +
    chapters.map(ch => `<option value="${ch.id}">#${ch.chapterNum || '?'} ${esc(ch.title)}</option>`).join('');
}

async function saveToChapter() {
  const chId = document.getElementById('chapterSaveTarget').value;
  if (!chId) { showToast('เลือกตอนก่อน', 'error'); return; }
  const source = document.getElementById('sourceText').value.trim();
  const output = document.getElementById('translationOutput');
  const translation = output.innerText.trim();
  if (!translation || translation === 'คำแปลจะปรากฏที่นี่...') { showToast('ยังไม่มีคำแปล', 'error'); return; }
  const ch = S.currentWs.chapters.find(c => c.id === chId);
  if (!ch) return;
  ch.sourceText = source;
  ch.translation = translation;
  ch.status = 'translated';
  ch.wordCount = translation.length;
  ch.updatedAt = Date.now();
  await lsSaveWorkspace(S.currentWs);
  updateChapterSaveSelect();
  showToast('บันทึกลงตอนแล้ว ✓', 'success');
}

// ════════════════════ GLOSSARY ════════════════════
function renderGlossaryTable(filter = '', typeFilter = '', sortBy = 'default') {
  const tbody = document.getElementById('glossaryTableBody');
  let data = [...(S.glossaryData || [])];
  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(g => g.korean.includes(q) || g.thai.includes(q) || (g.note || '').toLowerCase().includes(q));
  }
  if (typeFilter) data = data.filter(g => g.type === typeFilter);

  // Sort
  if (sortBy === 'korean-az') data.sort((a,b) => a.korean.localeCompare(b.korean));
  else if (sortBy === 'korean-za') data.sort((a,b) => b.korean.localeCompare(a.korean));
  else if (sortBy === 'thai-az') data.sort((a,b) => a.thai.localeCompare(b.thai, 'th'));
  else if (sortBy === 'type') data.sort((a,b) => (a.type||'').localeCompare(b.type||''));
  // default = insertion order (no sort)

  document.getElementById('glossaryCount').textContent = `${data.length} รายการ`;
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">ไม่พบรายการ</td></tr>`;
    return;
  }
  // Refresh type filter dropdown with any custom types
  refreshTypeFilter();
  const GENDER_LABEL = { male: '♂ ชาย', female: '♀ หญิง', neutral: '⚥ กลาง' };
  tbody.innerHTML = data.map(g => `
    <tr${g._rootWarning ? ' class="tr-root-warn"' : ''}>
      <td class="td-korean">${esc(g.korean)}</td>
      <td class="td-thai">${esc(g.thai)}${g._rootWarning ? `<span class="root-warn-badge" title="คำนี้มี root ซ้ำกับ &quot;${esc(g._rootWarning)}&quot; ที่มีอยู่แล้ว">⚠ root ซ้ำ</span>` : ''}</td>
      <td><span class="tag ${getTagClass(g.type || 'term')}">${esc(g.type || 'term')}</span></td>
      <td class="td-gender">${g.gender ? GENDER_LABEL[g.gender] || esc(g.gender) : '—'}</td>
      <td class="td-note">${esc(g.note || '')}</td>
      <td class="td-source">${g.sourceChapterTitle ? `<span title="${esc(g.sourceChapterTitle)}">#${g.sourceChapterNum || '?'} ${esc(g.sourceChapterTitle.slice(0,18))}${g.sourceChapterTitle.length>18?'…':''}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="td-del">
        <button onclick="editGlossaryEntry('${esc(g.korean)}')" title="แก้ไข">✏</button>
        <button onclick="deleteGlossaryEntry('${esc(g.korean)}')" title="ลบ">✕</button>
      </td>
    </tr>
  `).join('');
}

function filterGlossary() {
  renderGlossaryTable(
    document.getElementById('glossarySearch').value.trim(),
    document.getElementById('glossaryTypeFilter').value,
    document.getElementById('glossarySortSelect')?.value || 'default'
  );
}

function openAddGlossary() {
  S.editingGlossaryKorean = null;
  document.getElementById('glossaryModalTitle').textContent = '＋ เพิ่มคำศัพท์';
  ['gKorean','gThai','gNote'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('gType').value = 'term';
  document.getElementById('gGenderGroup').style.display = 'none';
  document.getElementById('gGender').value = '';
  document.getElementById('gKorean').readOnly = false;
  openModal('modal-add-glossary');
}

function editGlossaryEntry(korean) {
  const entry = S.glossaryData.find(g => g.korean === korean);
  if (!entry) return;
  S.editingGlossaryKorean = korean;
  document.getElementById('glossaryModalTitle').textContent = '✏ แก้ไขคำศัพท์';
  document.getElementById('gKorean').value = entry.korean;
  document.getElementById('gKorean').readOnly = true;
  document.getElementById('gThai').value = entry.thai;
  // Auto-add type if not in preset dropdown
  ensureTypeInDropdown(entry.type);
  document.getElementById('gType').value = entry.type || 'term';
  document.getElementById('gNote').value = entry.note || '';
  // gender: แสดงเฉพาะ character
  const isChar = (entry.type || 'term') === 'character';
  document.getElementById('gGenderGroup').style.display = isChar ? '' : 'none';
  document.getElementById('gGender').value = entry.gender || '';
  openModal('modal-add-glossary');
}

async function saveGlossaryEntry() {
  const korean = document.getElementById('gKorean').value.trim();
  const thai = document.getElementById('gThai').value.trim();
  if (!korean || !thai) { showToast('กรอก Korean และ Thai ก่อน', 'error'); return; }
  const type = document.getElementById('gType').value;
  const gender = type === 'character' ? document.getElementById('gGender').value : '';
  const entry = { korean, thai, type, note: document.getElementById('gNote').value.trim(), ...(gender ? { gender } : {}) };
  if (S.editingGlossaryKorean) {
    // ลบ entry เก่าก่อน (กรณีผู้ใช้เปลี่ยน Korean term ด้วย)
    S.currentWs.glossary = S.currentWs.glossary.filter(g => g.korean !== S.editingGlossaryKorean);
    // ถ้ามี Korean ใหม่ที่ซ้ำกับ entry อื่น → ทับ entry นั้น
    const dupIdx = S.currentWs.glossary.findIndex(g => g.korean === korean);
    if (dupIdx >= 0) S.currentWs.glossary[dupIdx] = entry;
    else S.currentWs.glossary.push(entry);
  } else {
    const exists = S.currentWs.glossary.findIndex(g => g.korean === korean);
    if (exists >= 0) S.currentWs.glossary[exists] = entry;
    else S.currentWs.glossary.push(entry);
  }
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  closeModal('modal-add-glossary');
  renderGlossaryTable();
  showToast(`บันทึก "${korean}" แล้ว`, 'success');
  // Resolve QA issue if opened from QA modal
  if (window._qaPendingResolve) {
    window._qaPendingResolve.callback();
    window._qaPendingResolve = null;
  }
}

async function deleteGlossaryEntry(korean) {
  if (!confirm(`ลบ "${korean}"?`)) return;
  S.currentWs.glossary = S.currentWs.glossary.filter(g => g.korean !== korean);
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  showToast(`ลบ "${korean}" แล้ว`, '');
}

// ─── Split Chapter ───
function openSplitChapter() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  const lines = (ch.sourceText || '').split('\n');
  document.getElementById('splitTotalLines').textContent = `(ทั้งหมด ${lines.length} บรรทัด)`;
  document.getElementById('splitLineNum').value = Math.ceil(lines.length / 2);
  document.getElementById('splitTitle1').value = ch.title;
  document.getElementById('splitTitle2').value = ch.title + ' (2)';
  document.getElementById('splitPreview').textContent = '';
  document.getElementById('splitLineNum').oninput = updateSplitPreview;
  updateSplitPreview();
  openModal('modal-split-chapter');
}

function updateSplitPreview() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  const lines = (ch.sourceText || '').split('\n');
  const at = parseInt(document.getElementById('splitLineNum').value) || 1;
  const p1 = lines.slice(0, at).join('\n').slice(0, 120);
  const p2 = lines.slice(at).join('\n').slice(0, 120);
  document.getElementById('splitPreview').textContent =
    `ส่วนที่ 1 (${at} บรรทัด):\n${p1}…\n\nส่วนที่ 2 (${lines.length - at} บรรทัด):\n${p2}…`;
}

async function confirmSplitChapter() {
  const ch = S.currentWs?.chapters.find(c => c.id === S.editingChapterId);
  if (!ch) return;
  const lines = (ch.sourceText || '').split('\n');
  const at = Math.max(1, Math.min(parseInt(document.getElementById('splitLineNum').value) || 1, lines.length - 1));
  const title1 = document.getElementById('splitTitle1').value.trim() || ch.title;
  const title2 = document.getElementById('splitTitle2').value.trim() || ch.title + ' (2)';

  // แก้ part 1 (ใช้ id เดิม)
  ch.title = title1;
  ch.sourceText = lines.slice(0, at).join('\n');
  ch.translation = '';
  ch.status = 'pending';
  ch.updatedAt = Date.now();

  // สร้าง part 2 ใหม่ (chapterNum +0.5 ก่อน renumber)
  const newCh = {
    id: genId(),
    title: title2,
    chapterNum: (ch.chapterNum || 0) + 0.5,
    sourceText: lines.slice(at).join('\n'),
    translation: '',
    status: 'pending',
    notes: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  S.currentWs.chapters.push(newCh);

  // Renumber ทั้ง WS ตามลำดับ
  [...S.currentWs.chapters]
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
    .forEach((c, i) => { c.chapterNum = i + 1; });

  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  closeModal('modal-split-chapter');
  closeModal('modal-view-chapter');
  showToast(`✂ Split เสร็จ — "${title1}" และ "${title2}"`, 'success');
}

// ─── Merge Chapter ───
function openMergeChapter() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const ch = sorted[idx];
  if (!ch) return;
  const next = sorted[idx + 1];
  const prev = sorted[idx - 1];
  let info = `<b>${esc(ch.title)}</b>`;
  if (next) info += `<br>+ ถัดไป: <b>${esc(next.title)}</b>`;
  else info += '<br><span style="color:var(--crimson-light)">ไม่มีตอนถัดไป</span>';
  if (prev) info += `<br>+ ก่อนหน้า: <b>${esc(prev.title)}</b>`;
  else info += '<br><span style="color:var(--text-muted)">ไม่มีตอนก่อนหน้า</span>';
  document.getElementById('mergeInfo').innerHTML = info;
  document.getElementById('mergeTitleResult').value = ch.title;
  // default direction
  const radios = document.querySelectorAll('input[name="mergeDir"]');
  radios.forEach(r => { if (r.value === 'next') r.checked = true; });
  openModal('modal-merge-chapter');
}

async function confirmMergeChapter() {
  const sorted = _getSortedChapters();
  const idx = sorted.findIndex(c => c.id === S.editingChapterId);
  const ch = sorted[idx];
  if (!ch) return;
  const dir = document.querySelector('input[name="mergeDir"]:checked')?.value || 'next';
  const other = dir === 'next' ? sorted[idx + 1] : sorted[idx - 1];
  if (!other) { showToast(`ไม่มีตอน${dir === 'next' ? 'ถัดไป' : 'ก่อนหน้า'}`, 'error'); return; }
  const newTitle = document.getElementById('mergeTitleResult').value.trim() || ch.title;

  // Merge: ต้นฉบับ + แปล ต่อกัน
  const sep = '\n\n';
  const [first, second] = dir === 'next' ? [ch, other] : [other, ch];
  ch.title = newTitle;
  ch.chapterNum = first.chapterNum;
  ch.sourceText  = [first.sourceText, second.sourceText].filter(Boolean).join(sep);
  ch.translation = [first.translation, second.translation].filter(Boolean).join(sep);
  ch.status = ch.translation.trim() ? 'translated' : 'pending';
  ch.wordCount = ch.translation.length;
  ch.updatedAt = Date.now();

  // ลบตอนที่ merge เข้าไป
  S.currentWs.chapters = S.currentWs.chapters.filter(c => c.id !== other.id);

  // Renumber
  [...S.currentWs.chapters]
    .sort((a, b) => (a.chapterNum || 0) - (b.chapterNum || 0))
    .forEach((c, i) => { c.chapterNum = i + 1; });

  await lsSaveWorkspace(S.currentWs);
  renderChapters();
  updateChapterSaveSelect();
  closeModal('modal-merge-chapter');
  closeModal('modal-view-chapter');
  showToast(`🔗 Merge เสร็จ — "${newTitle}"`, 'success');
}
