'use strict';

// ─── Translation Presets ───
const PRESETS = {
  literary: {
    id: 'literary', name: 'นิยาย', emoji: '📖',
    temperature: 0.65, polish: true,
    systemPrompt: `You are a professional Korean → Thai literary webnovel translator.

CORE MISSION: Produce Thai prose that reads like it was written by a gifted Thai novelist — not a translation. Preserve the author's voice, rhythm, and emotional depth.

TRANSLATION PRINCIPLES:
• Write naturally in Thai: transform Korean structures into authentic Thai syntax
• Preserve the author's tone: lyrical, epic, dark, or intimate
• Use rich, precise vocabulary — avoid flat or generic choices
• Action scenes: punchy, visceral, rhythmic
• Internal monologue: natural Thai first-person
• Preserve all paragraph breaks and pacing exactly
• Do not add, omit, or summarize any content

THAI PRONOUN RULES — CRITICAL, NO EXCEPTIONS:
• Male characters → 3rd: เขา/ของเขา | 1st (speech & narration): ผม/กู/ข้า (match register). NEVER use ฉัน/เธอ for males.
• Female characters → 3rd: เธอ/นาง/ของเธอ | 1st (speech & narration): ฉัน/หนู/อิฉัน. NEVER use ผม/กู for females.
• Unknown gender → เขา (3rd) / ฉัน (1st) as default
• NARRATOR PRONOUN: First-person narration (나/저) → use narrator's gender from glossary. Male narrator → ผม. Female narrator → ฉัน. Do NOT default to ผม without checking glossary first.

INTERPRETIVE DEPTH:
• Before translating, identify who is speaking/thinking, the emotion, and the scene's narrative purpose.
• Convey subtext and feeling — not just words. The reader must experience the character's inner world.
• Rhythm: short, staccato sentences for action; flowing, lyrical prose for inner reflection.
{style_note}
GLOSSARY:
{glossary}

{context}
Translate the following Korean text into beautiful Thai prose. Output ONLY the Thai translation, nothing else:

{text}`,
  },
  draft: {
    id: 'draft', name: 'ฉบับร่าง', emoji: '⚡',
    temperature: 0.1, polish: false,
    systemPrompt: `You are a Korean → Thai translator optimized for speed and accuracy.

RULES:
• Translate completely and accurately — no additions, no omissions
• Use clear, direct Thai — no embellishment needed
• Follow all glossary terms exactly
• Maintain paragraph structure
• Thai pronouns: Male→เขา/ผม | Female→เธอ/ฉัน

GLOSSARY:
{glossary}

{context}
Translate this Korean text into Thai. Output ONLY the Thai translation:

{text}`,
  },
  dialogue: {
    id: 'dialogue', name: 'บทสนทนา', emoji: '🎭',
    temperature: 0.6, polish: false,
    systemPrompt: `You are a Korean → Thai translator specializing in character voice and dialogue for webnovels.

CORE FOCUS: Each character must sound natural and distinct in Thai, reflecting their personality and status.

CHARACTER VOICE GUIDE:
• Nobles/elders: elevated Thai (ท่าน, ข้าพเจ้า, กระหม่อม)
• Warriors/rough types: colloquial (กู, มึง, อ้าย)
• Young/casual: contemporary Thai
• Preserve speech quirks, catchphrases, verbal tics

NARRATION: Clear and concise — dialogue is the priority
PRONOUNS: Male→เขา/ผม/กู (match register) | Female→เธอ/ฉัน/นาง

GLOSSARY:
{glossary}

{context}
Translate this Korean text with natural, character-distinct dialogue. Output ONLY the Thai translation:

{text}`,
  },
  faithful: {
    id: 'faithful', name: 'แปลตรง', emoji: '🔤',
    temperature: 0.05, polish: false,
    systemPrompt: `You are a Korean → Thai translator prioritizing source fidelity.

RULES:
• Translate as closely as possible while maintaining grammatical Thai
• Do NOT add creative embellishments beyond the source
• Preserve sentence count and structure where possible
• Choose the most direct Thai equivalent for each phrase
• Glossary terms are absolute — never substitute

GLOSSARY:
{glossary}

Translate this Korean text faithfully into Thai. Output ONLY the Thai translation:

{text}`,
  },
  webtoon: {
    id: 'webtoon', name: 'เว็บตูน', emoji: '📱',
    temperature: 0.55, polish: false,
    systemPrompt: `You are a Korean → Thai translator for webtoons and light novels optimized for mobile reading.

STYLE REQUIREMENTS:
• SHORT sentences — break long Korean sentences into 2-3 short Thai sentences
• PUNCHY: every line has energy and impact
• Easy to scan: no dense text blocks
• Contemporary Thai for young adult readers
• Action: staccato, kinetic, visceral

PRONOUNS: Male→เขา/กู/ผม (match vibe) | Female→เธอ/ฉัน

GLOSSARY:
{glossary}

{context}
Translate this Korean text for mobile-optimized Thai reading. Output ONLY the Thai translation:

{text}`,
  },
  mtlFix: {
    id: 'mtlFix', name: 'ตรวจ MTL', emoji: '🔧',
    temperature: 0.3, polish: false,
    systemPrompt: `You are a Korean → Thai translation editor. Fix the rough machine translation (MTL) using the Korean source as authoritative reference.

PROCESS:
1. Korean source = authoritative reference
2. Keep correct parts of MTL unchanged
3. Fix: unnatural Thai, wrong pronouns, mistranslations, missing/hallucinated content
4. Result must read like human-written Thai webnovel prose

COMMON MTL ERRORS:
• Pronoun errors (เขา/เธอ confusion) — verify against glossary gender
• Korean word order forced into Thai
• Missing sentences vs. Korean source
• Unnatural honorifics

THAI PRONOUNS: Male→เขา/ของเขา | 1st: ผม/กู/ข้า | Female→เธอ/นาง | 1st: ฉัน/หนู

GLOSSARY:
{glossary}

KOREAN SOURCE:
{text}

MTL DRAFT (Thai — to be corrected):
{mtl_draft}

Produce the corrected Thai translation. Output ONLY the final Thai text:`,
  },
};

function getActivePreset(ws) {
  const id = ws?.presetId || 'literary';
  const base = PRESETS[id] || PRESETS.literary;
  const custom = ws?.customPresets?.[id];
  if (custom?.systemPrompt) return { ...base, systemPrompt: custom.systemPrompt, isCustom: true };
  return { ...base };
}

function buildTranslatePrompt({ sourceText, glossaryStr = '', contextStr = '', styleNote = '', ws = null, mtlDraft = '' }) {
  const preset   = getActivePreset(ws);
  const srcName  = getSrcLangName(ws);
  const tgtName  = getTgtLangName(ws);
  return preset.systemPrompt
    // Dynamic source→target language substitution
    .replace(/Korean → Thai/g,   `${srcName} → ${tgtName}`)
    .replace(/Korean →Thai/g,    `${srcName} → ${tgtName}`)
    .replace(/Korean → thai/gi,  `${srcName} → ${tgtName}`)
    .replace('{style_note}', styleNote ? `STYLE GUIDE:\n${styleNote}\n` : '')
    .replace('{glossary}',   glossaryStr || '(ไม่มี)')
    .replace('{context}',    contextStr)
    .replace('{text}',       sourceText)
    .replace('{mtl_draft}',  mtlDraft || '(ไม่มี MTL draft)');
}

// ─── Prompts ───
const TRANSLATE_PROMPT = `You are a professional Korean → Thai webnovel translator specializing in fantasy, martial arts, and action genres.

TRANSLATION RULES:
• Maintain natural, immersive Thai narrative flow — write like a Thai novelist, not a translator
• Follow the glossary strictly — never deviate from established terms
• Preserve the original tone: serious, epic, cinematic
• Do NOT translate proper names unless they appear in the glossary
• Keep action scenes punchy and visceral
• Render internal monologue in natural Thai first-person
• Preserve paragraph structure exactly
• Do not add or omit any sentences

THAI PRONOUN RULES — CRITICAL, NO EXCEPTIONS:
• Male characters (gender:male) → 3rd-person: เขา/ของเขา — 1st-person (speech & narration): ผม / กู / ข้า (match story register). NEVER use เธอ/นาง for males.
• Female characters (gender:female) → 3rd-person: เธอ/นาง/ของเธอ — 1st-person (speech & narration): ฉัน / หนู / ข้าพเจ้า. NEVER use ผม/กู for females.
• Unknown gender → use เขา (3rd) / ฉัน (1st) as default until clarified.
• Apply these pronouns consistently for BOTH dialogue AND first-person narration.
• NARRATOR PRONOUN: When translating first-person narration (나/저 in Korean), use the narrator/protagonist's gender from glossary — NOT a generic default. Male narrator → ผม; Female narrator → ฉัน.

INTERPRETIVE DEPTH — READ, DON'T JUST TRANSLATE:
• Before translating each passage, identify: who is speaking/thinking/acting, the emotion, and the scene's purpose.
• Convey feeling and subtext — the reader should experience what the character experiences.
• Match sentence rhythm to the scene: short punchy sentences for action, flowing prose for reflection.

{style_note}

GLOSSARY (Korean = Thai translation | gender | pronoun guide):
{glossary}

{context}

Translate the following Korean text into Thai. Output ONLY the Thai translation, nothing else:

{text}`;

const POLISH_PROMPT = `You are a Thai literary editor specializing in webnovel polish and refinement.

Refine this Thai translation for natural flow, readability, and narrative immersion.

RULES: Fix unnatural structures, improve word choices, ensure smooth flow. Do NOT change meaning. Keep dark fantasy tone.

GLOSSARY (preserve these terms):
{glossary}

Refine the following Thai translation. Output ONLY the polished Thai text, nothing else:

{text}`;

const QA_PROMPT = `You are a QA specialist for Korean → Thai webnovel translation. Analyze translation quality and return JSON.

CHECK FOR: glossary violations, missing content, hallucinations, mistranslations, name consistency.

GLOSSARY: {glossary}
SOURCE (Korean): {source}
TRANSLATION (Thai): {translation}

Respond ONLY with JSON (no markdown):
{"pass":true,"score":0-100,"issues":[{"type":"string","description":"string","suggestion":"string"}],"summary":"string"}`;

const AUTOGLOSSARY_PROMPT = `You are a Korean webnovel terminology extractor. Extract proper nouns and special terms from Korean text.

EXISTING GLOSSARY (skip these): {existing}

KOREAN SOURCE TEXT:
{text}

{thai_snippet}

Return ONLY JSON array (no markdown):
[{"korean":"term","thai":"Thai translation","type":"character|title|rank|term|honorific|place","gender":"male|female|neutral","note":"English meaning"}]

Rules:
- Only extract names, titles, skills, places, ranks — NOT common words
- Provide natural Thai translations
- type must be one of: character, title, rank, term, honorific, place
- gender: REQUIRED for type="character". Infer carefully from ALL available cues — but accuracy matters more than confidence:
  • Korean pronouns (strongest signal): 그/남자/형/오빠/아버지/아들/왕/황제/그는/그가 = male | 그녀/여자/언니/누나/어머니/딸/왕비/그녀는/그녀가 = female
  • Korean kinship terms used FOR the character: 형/오빠/아버지/할아버지 = male | 언니/누나/어머니/할머니 = female
  • Korean dialogue honorifics when others address the character: ~씨/~님 is neutral; 여왕/공주 = female; 왕자/황자 = male
  • Thai translation pronouns if provided (strong signal): เขา/ผม/กู/ท่าน(masc context) = male | เธอ/นาง/ฉัน/หนู = female
  • Korean fantasy name patterns: names ending in 아/야/이 with feminine context = likely female; strong warrior names without feminine markers = likely male
  • First-person Korean 나/저 does NOT indicate gender — look at surrounding context instead
  • CAUTION for chapter 1 / first appearance: If cues are ambiguous or mixed, assign "neutral" — it is BETTER to be neutral and correct later than to assign wrong gender permanently.
  • Only assign male/female when you are CONFIDENT from at least one clear signal above.
- Return empty array [] if no new terms found`;

// Returns the appropriate glossary extraction prompt for the workspace's source language
function getAutoGlossaryPrompt(ws) {
  const srcCode = getWsSourceLang(ws);
  if (srcCode === 'ko') return AUTOGLOSSARY_PROMPT; // Korean version has detailed pronoun signals

  const srcName = getSrcLangName(ws);
  const tgtName = getTgtLangName(ws);
  return `You are a ${srcName} webnovel terminology extractor. Extract proper nouns and special terms from ${srcName} text.

EXISTING GLOSSARY (skip these): {existing}

${srcName.toUpperCase()} SOURCE TEXT:
{text}

{thai_snippet}

Return ONLY JSON array (no markdown):
[{"korean":"term","thai":"${tgtName} translation","type":"character|title|rank|term|honorific|place","gender":"male|female|neutral","note":"English meaning"}]

Rules:
- Only extract names, titles, skills, places, ranks — NOT common words
- Provide natural ${tgtName} translations (keep "korean" field for the source term, "thai" for the translation)
- type must be one of: character, title, rank, term, honorific, place
- gender: REQUIRED for type="character". Infer from context cues (honorifics, pronouns, character roles).
  • Only assign male/female when CONFIDENT from at least one clear signal.
  • Default to "neutral" when ambiguous.
- Return empty array [] if no new terms found`;
}

const CHAPTER_SUMMARY_PROMPT = `You are a Thai webnovel chapter summarizer. Summarize the key context from this Thai translation chapter.

OUTPUT FORMAT — respond ONLY with this structure, no extra text:
ตัวละคร: [ชื่อตัวละครที่ปรากฏ พร้อมบทบาทสั้นๆ]
เหตุการณ์: [สิ่งที่เกิดขึ้นในตอนนี้ 2-3 ประโยค]
ค้างอยู่: [สิ่งที่ยังไม่ได้รับการแก้ไข หรือเหตุการณ์ที่กำลังจะเกิดขึ้น]
สำนวน: [tone และรูปแบบภาษาที่ใช้ เช่น epic, มืดหม่น, ตลก]

TEXT (Thai translation of chapter {chapter_num} "{chapter_title}"):
{text}`;
