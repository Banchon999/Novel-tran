'use strict';

// ════════════════════ API ════════════════════
async function callOpenRouter({ model, messages, temperature = 0.7, max_tokens = 2000, stream = false }) {
  const key = getApiKey();
  if (!key) throw new Error('ยังไม่ได้ตั้ง API Key — ไปที่ ⚙ ตั้งค่า');

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'NovelTrans v10 Pro',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens, stream }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  if (stream) return res;

  const data = await res.json();
  // Track costs
  const usage = data.usage || {};
  addCosts(usage.prompt_tokens || 0, usage.completion_tokens || 0, model);
  return data;
}

const MODEL_COSTS = {
  // Google
  'google/gemini-2.5-flash':           { in: 0.15,  out: 0.60 },
  'google/gemini-2.5-flash-lite':      { in: 0.075, out: 0.30 },
  'google/gemini-2.5-pro':             { in: 1.25,  out: 10.0 },
  'google/gemini-2.0-flash-001':       { in: 0.10,  out: 0.40 },
  'google/gemini-1.5-flash':           { in: 0.075, out: 0.30 },
  // OpenAI
  'openai/gpt-5-nano':                 { in: 0.15,  out: 0.60 },
  'openai/gpt-5':                      { in: 5.00,  out: 25.0 },
  'openai/gpt-4.1-nano':               { in: 0.10,  out: 0.40 },
  'openai/gpt-4o-mini':                { in: 0.15,  out: 0.60 },
  'openai/gpt-4o':                     { in: 2.50,  out: 10.0 },
  'openai/gpt-oss-120b':               { in: 1.00,  out: 4.00 },
  // DeepSeek
  'deepseek/deepseek-v3.2':            { in: 0.14,  out: 0.28 },
  'deepseek/deepseek-chat-v3-0324':    { in: 0.14,  out: 0.28 },
  'deepseek/deepseek-chat':            { in: 0.14,  out: 0.28 },
  'deepseek/deepseek-r1':              { in: 0.55,  out: 2.19 },
  // xAI
  'x-ai/grok-4':                       { in: 3.00,  out: 15.0 },
  'x-ai/grok-4-fast':                  { in: 0.20,  out: 0.50 },
  // Anthropic / Meta
  'anthropic/claude-haiku-4.5':        { in: 0.80,  out: 4.00 },
  'anthropic/claude-3-haiku':          { in: 0.25,  out: 1.25 },
  'meta-llama/llama-3.3-70b-instruct:free': { in: 0, out: 0 },
  'meta-llama/llama-4-scout:free':     { in: 0,     out: 0 },
};

// ─── Built-in Model Registry (mirrors the HTML selects) ───
const BUILTIN_MODELS = [
  { group: 'Google', models: [
    { id: 'google/gemini-2.5-flash',      name: 'Gemini 2.5 Flash 🔥' },
    { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    { id: 'google/gemini-2.5-pro',        name: 'Gemini 2.5 Pro' },
    { id: 'google/gemini-2.0-flash-001',  name: 'Gemini 2.0 Flash' },
    { id: 'google/gemini-1.5-flash',      name: 'Gemini 1.5 Flash' },
  ]},
  { group: 'OpenAI', models: [
    { id: 'openai/gpt-5-nano',    name: 'GPT-5 Nano ✨' },
    { id: 'openai/gpt-5',         name: 'GPT-5' },
    { id: 'openai/gpt-4.1-nano',  name: 'GPT-4.1 Nano' },
    { id: 'openai/gpt-4o-mini',   name: 'GPT-4o Mini' },
    { id: 'openai/gpt-4o',        name: 'GPT-4o' },
    { id: 'openai/gpt-oss-120b',  name: 'GPT-OSS 120B' },
  ]},
  { group: 'DeepSeek', models: [
    { id: 'deepseek/deepseek-v3.2',         name: 'DeepSeek V3.2 🆕' },
    { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3 (Mar)' },
    { id: 'deepseek/deepseek-chat',         name: 'DeepSeek V3' },
    { id: 'deepseek/deepseek-r1',           name: 'DeepSeek R1' },
  ]},
  { group: 'xAI', models: [
    { id: 'x-ai/grok-4',      name: 'Grok 4' },
    { id: 'x-ai/grok-4-fast', name: 'Grok 4 Fast' },
  ]},
  { group: 'อื่นๆ', models: [
    { id: 'anthropic/claude-haiku-4.5',                 name: 'Claude Haiku 4.5' },
    { id: 'anthropic/claude-3-haiku',                   name: 'Claude Haiku 3' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free',     name: 'Llama 3.3 70B (ฟรี)' },
    { id: 'meta-llama/llama-4-scout:free',              name: 'Llama 4 Scout (ฟรี)' },
  ]},
];

// ─── Custom Models ───
function getCustomModels() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_CUSTOM_MODELS)) || []; }
  catch { return []; }
}
function saveCustomModels(list) {
  localStorage.setItem(LS_KEY_CUSTOM_MODELS, JSON.stringify(list));
}

// Task names: translate | polish | glossary | qa | summary
function getModelForTask(task, ws) {
  const wsObj = ws || S.currentWs;
  const roles = wsObj?.settings?.modelRoles || {};
  const assigned = roles[task];
  if (assigned && assigned !== 'default') return assigned;
  return wsObj?.settings?.translateModel
    || document.getElementById('translateModel')?.value
    || 'deepseek/deepseek-chat';
}

// Inject custom models optgroup into every model <select>
function refreshModelSelects() {
  const custom = getCustomModels();
  const selectIds = ['translateModel', 'wsTranslateModel', 'bchModel', 'agModel'];
  selectIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value;
    // Remove old custom optgroup
    const existing = el.querySelector('optgroup[data-custom="1"]');
    if (existing) existing.remove();
    if (!custom.length) return;
    const og = document.createElement('optgroup');
    og.label = '── Custom ──';
    og.dataset.custom = '1';
    custom.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = (m.name || m.id) + (m.costIn ? ` ($${m.costIn}/$${m.costOut})` : '');
      og.appendChild(opt);
    });
    el.appendChild(og);
    // Restore selection if still valid
    if (currentVal && [...el.options].some(o => o.value === currentVal)) el.value = currentVal;
  });
}

function addCosts(inputTok, outputTok, model) {
  const rates = MODEL_COSTS[model] || { in: 0.1, out: 0.3 };  // fallback ใช้ค่ากลาง ไม่เกินจริง
  const usd = (inputTok / 1e6 * rates.in) + (outputTok / 1e6 * rates.out);
  // ─ Global cost ─
  S.costs.tokens.input += inputTok;
  S.costs.tokens.output += outputTok;
  S.costs.tokens.total += inputTok + outputTok;
  S.costs.costUSD += usd;
  S.costs.costTHB = S.costs.costUSD * 35;
  localStorage.setItem(LS_KEY_COSTS, JSON.stringify(S.costs));
  // ─ Per-Workspace cost ─
  if (S.currentWs) {
    if (!S.currentWs.costs) S.currentWs.costs = { tokens: { total:0, input:0, output:0 }, costUSD:0 };
    S.currentWs.costs.tokens.input  += inputTok;
    S.currentWs.costs.tokens.output += outputTok;
    S.currentWs.costs.tokens.total  += inputTok + outputTok;
    S.currentWs.costs.costUSD       += usd;
    // debounce save (ไม่ save ทุก chunk)
    clearTimeout(S._costSaveTimer);
    S._costSaveTimer = setTimeout(() => lsSaveWorkspace(S.currentWs).catch(err => console.error('[AutoSave]', err)), 3000);
  }
  updateCostUI();
}

function fmtUSD(v) {
  // C2: แสดง 4 ทศนิยมถ้า < $0.01, ไม่งั้น 2 ทศนิยม
  if (v === 0) return '$0.0000';
  return v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2);
}

function updateCostUI() {
  const c = S.costs;
  document.getElementById('totalTokens').textContent = c.tokens.total.toLocaleString();
  document.getElementById('inputTokens').textContent = c.tokens.input.toLocaleString();
  document.getElementById('outputTokens').textContent = c.tokens.output.toLocaleString();
  document.getElementById('costUSD').textContent = fmtUSD(c.costUSD);
  document.getElementById('costTHB').textContent = '฿' + c.costTHB.toFixed(2);
  document.getElementById('costBadge').textContent = fmtUSD(c.costUSD);
  document.getElementById('costMini').textContent = fmtUSD(c.costUSD);
  // Per-WS cost
  const wc = S.currentWs?.costs;
  const wsUSD = document.getElementById('wsOwnCostUSD');
  const wsTok = document.getElementById('wsOwnTokens');
  if (wsUSD) wsUSD.textContent = fmtUSD(wc?.costUSD || 0);
  if (wsTok) wsTok.textContent = (wc?.tokens?.total || 0).toLocaleString();
}

function resetWsCosts() {
  if (!S.currentWs) return;
  if (!confirm('รีเซ็ต cost ของ Workspace นี้?')) return;
  S.currentWs.costs = { tokens: { total:0, input:0, output:0 }, costUSD:0 };
  lsSaveWorkspace(S.currentWs).catch(err => console.error('[Save]', err));
  updateCostUI();
  showToast('รีเซ็ต cost ของ Workspace นี้แล้ว', 'success');
}
