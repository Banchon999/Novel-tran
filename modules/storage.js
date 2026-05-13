'use strict';

// ════════════════════ STORAGE ════════════════════
const LS_KEY_COSTS          = 'nt8_costs';
const LS_KEY_API            = 'nt8_apikey';
const LS_KEY_CUSTOM_MODELS  = 'nt8_custom_models';

// ─── Source / Target Language Definitions ───
const SOURCE_LANGS = [
  { code: 'ko',    name: 'เกาหลี',         nameEn: 'Korean' },
  { code: 'ja',    name: 'ญี่ปุ่น',         nameEn: 'Japanese' },
  { code: 'zh',    name: 'จีน (ตัวย่อ)',    nameEn: 'Chinese Simplified' },
  { code: 'zh-tw', name: 'จีน (ตัวเต็ม)',  nameEn: 'Chinese Traditional' },
  { code: 'en',    name: 'อังกฤษ',          nameEn: 'English' },
  { code: 'vi',    name: 'เวียดนาม',        nameEn: 'Vietnamese' },
  { code: 'other', name: 'อื่นๆ',            nameEn: 'Other' },
];
const TARGET_LANGS = [
  { code: 'th', name: 'ไทย',          nameEn: 'Thai' },
  { code: 'en', name: 'อังกฤษ',       nameEn: 'English' },
  { code: 'zh', name: 'จีน (ตัวย่อ)', nameEn: 'Chinese Simplified' },
];

function getWsSourceLang(ws)     { return (ws || S.currentWs)?.settings?.sourceLang || 'ko'; }
function getWsTargetLang(ws)     { return (ws || S.currentWs)?.settings?.targetLang || 'th'; }
function getWsSourceLangInfo(ws) { return SOURCE_LANGS.find(l => l.code === getWsSourceLang(ws)) || SOURCE_LANGS[0]; }
function getWsTargetLangInfo(ws) { return TARGET_LANGS.find(l => l.code === getWsTargetLang(ws)) || TARGET_LANGS[0]; }
function getSrcLangName(ws)      { return getWsSourceLangInfo(ws).nameEn; }
function getTgtLangName(ws)      { return getWsTargetLangInfo(ws).nameEn; }

// ── IndexedDB wrapper ──
const IDB_NAME    = 'NovelTransDB';
const IDB_VERSION = 1;
let _idb = null;

function idbOpen() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('workspaces')) db.createObjectStore('workspaces', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta'))       db.createObjectStore('meta');
    };
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror   = e => reject(e.target.error);
  });
}

function idbGet(store, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  }));
}

function idbPut(store, value, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => {
      const err = e.target.error;
      if (err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        showToast('⚠ พื้นที่จัดเก็บเต็ม (IndexedDB Quota) — กรุณา Export JSON แล้วลบ Workspace เก่าออก', 'error');
      }
      reject(err);
    };
  }));
}

function idbDelete(store, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }));
}

function idbGetAll(store) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

// ── Workspace list stored in IDB meta ──
async function lsGetWorkspaceList() {
  return (await idbGet('meta', 'ws_list')) || [];
}
async function lsSaveWorkspaceList(list) {
  await idbPut('meta', list, 'ws_list');
}
async function lsGetWorkspace(id) {
  return (await idbGet('workspaces', id)) || null;
}
async function lsSaveWorkspace(ws) {
  await idbPut('workspaces', ws);
  const list = await lsGetWorkspaceList();
  const idx  = list.findIndex(w => w.id === ws.id);
  const meta = { id: ws.id, name: ws.name, emoji: ws.emoji || '📖', chapterCount: (ws.chapters || []).length };
  if (idx >= 0) list[idx] = meta; else list.push(meta);
  await lsSaveWorkspaceList(list);
}
async function lsDeleteWorkspace(id) {
  await idbDelete('workspaces', id);
  const list = (await lsGetWorkspaceList()).filter(w => w.id !== id);
  await lsSaveWorkspaceList(list);
}

// ── last_ws in IDB meta ──
async function getLastWs()       { return (await idbGet('meta', 'last_ws')) || null; }
async function setLastWs(id)     { await idbPut('meta', id, 'last_ws'); }
async function clearLastWs()     { await idbDelete('meta', 'last_ws'); }

// ── Migration: move old localStorage workspaces into IDB (runs once) ──
async function migrateFromLocalStorage() {
  const migrated = localStorage.getItem('nt8_idb_migrated');
  if (migrated) return;
  try {
    let oldList;
    try { oldList = JSON.parse(localStorage.getItem('nt8_workspaces') || '[]'); }
    catch { oldList = []; }

    if (!oldList.length) { localStorage.setItem('nt8_idb_migrated', '1'); return; }

    let count = 0, skipped = 0;
    for (const meta of oldList) {
      const raw = localStorage.getItem('nt8_ws_' + meta.id);
      if (!raw) { skipped++; continue; }
      try {
        const ws = JSON.parse(raw);
        await idbPut('workspaces', ws);
        count++;
      } catch(parseErr) {
        // Truncated JSON — try to salvage: keep the meta entry so user knows it existed
        console.warn(`Migration: workspace ${meta.id} "${meta.name}" has corrupt JSON, skipping`);
        skipped++;
      }
    }

    await idbPut('meta', oldList.slice(), 'ws_list');
    const lastWs = localStorage.getItem('nt8_last_ws');
    if (lastWs) await idbPut('meta', lastWs, 'last_ws');

    // Clean up old keys only for successfully migrated workspaces
    for (const meta of oldList) localStorage.removeItem('nt8_ws_' + meta.id);
    localStorage.removeItem('nt8_workspaces');
    localStorage.removeItem('nt8_last_ws');
    localStorage.setItem('nt8_idb_migrated', '1');

    if (count) showToast(`✓ ย้ายข้อมูล ${count} Workspace มา IndexedDB แล้ว`, 'success');
    if (skipped) {
      setTimeout(() => showToast(`⚠ ${skipped} Workspace มีข้อมูลเสียหาย (localStorage เต็ม) — ใช้ Import JSON แทน`, 'error'), 2000);
    }
  } catch(e) {
    console.warn('Migration failed:', e);
    localStorage.setItem('nt8_idb_migrated', '1');
  }
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// API key: stays in localStorage (< 100 bytes, never causes quota issues)
function getApiKey() { return localStorage.getItem(LS_KEY_API) || ''; }
