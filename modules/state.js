'use strict';

// ═══════════════════════════════════════════════
// NovelTrans v10 Pro — Multi-file Edition
// IndexedDB backend + OpenRouter API (SSE streaming)
// ═══════════════════════════════════════════════

// ─── Constants ───
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─── State ───
const S = {
  currentWsId: null,
  currentWs: null,
  currentTab: 'translate',
  translating: false,
  editingChapterId: null,
  editingStyleId: null,
  editingGlossaryKorean: null,
  activeStyleId: 'natural',
  glossaryData: [],
  costs: { tokens: { total:0, input:0, output:0 }, costUSD:0, costTHB:0 },
  abortCtrl: null,  // ← global AbortController สำหรับหยุดการแปลได้จริง
};

const BUILTIN_STYLES = {
  natural:   { id: 'natural',   emoji: '🌿', name: 'Natural',    prompt: 'แปลให้เป็นธรรมชาติ อ่านง่าย เหมือนนิยายไทยต้นฉบับ' },
  epic:      { id: 'epic',      emoji: '⚔',  name: 'Epic',       prompt: 'แปลให้รู้สึกยิ่งใหญ่ ดราม่า เน้นความเข้มข้นของฉากแอ็คชัน' },
  murim:     { id: 'murim',     emoji: '🥋', name: 'กำลังภายใน', prompt: 'แปลแบบสำนวนกำลังภายในคลาสสิก ใช้ภาษาไทยย้อนยุค เน้นเกียรติยศและวิชากระบี่' },
  modern:    { id: 'modern',    emoji: '🏙', name: 'Modern',     prompt: 'แปลให้สมัยใหม่ อ่านลื่น เหมาะกับนิยายร่วมสมัย' },
  literary:  { id: 'literary',  emoji: '📜', name: 'Literary',   prompt: 'แปลในสไตล์วรรณกรรม เน้นความงามของภาษา บรรยายละเอียด' },
};
