// Lidlar bazasi: kontaktni aniqlash, dublikatlarsiz saqlash, A–E baho,
// holat (yangi/aktiv/musor/sotildi), sotuv summasi va marketing xarajatlari.
// Ma'lumotlar data/ papkasida JSON fayllarda — qayta ishga tushganda yo'qolmaydi.
import fs from 'fs';

const DATA = new URL('./data/', import.meta.url);
fs.mkdirSync(DATA, { recursive: true });
const LEADS_F = new URL('leads.json', DATA);
const EXP_F = new URL('expenses.json', DATA);
const SRC_F = new URL('sources.json', DATA);
const DLG_F = new URL('dialogs.json', DATA);
const TZ = 'Asia/Tashkent';

export const STATUSES = ['yangi', 'aktiv', 'sotildi', 'musor'];
export const CATS = ['A', 'B', 'C', 'D', 'E'];

// ---------- Sana yordamchilari (Toshkent vaqti) ----------
export function tashNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: TZ })); }
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// ---------- Kontaktni aniqlash ----------
const TG_RE = /(?:t\.me\/|telegram\.me\/|@)([a-z][a-z0-9_]{4,31})/i;

function normalizePhone(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length === 9) return '+998' + d;
  if (d.length === 12 && d.startsWith('998')) return '+' + d;
  if (d.length === 10 && d.startsWith('8')) return '+998' + d.slice(1);
  if (d.length === 11 && d.startsWith('7')) return '+' + d;
  if (d.length >= 10 && d.length <= 13) return '+998' + d.slice(-9);
  return null;
}

export function extractContact(text) {
  let phone = null;
  for (const m of text.matchAll(/\+?\d[\d\s\-().]{7,20}\d/g)) {
    phone = normalizePhone(m[0]);
    if (phone) break;
  }
  const tg = text.match(TG_RE);
  const telegram = tg ? '@' + tg[1].toLowerCase() : null;
  return phone || telegram ? { phone, telegram } : null;
}

// ---------- A–E avtomatik baho ----------
export function scoreLead(lead) {
  const t = (lead.messages || []).join(' \n ').toLowerCase();
  let s = 0;
  const why = [];
  const add = (n, w) => { s += n; why.push(w); };

  if (lead.phone) add(30, 'telefon');
  else if (lead.telegram) add(15, 'telegram');

  const vol = t.match(/(\d+[.,]?\d*)\s*(m2|m²|м2|м²|kv\.?\s?m|кв\.?\s?м|kvadrat|квадрат|metr|метр)/i);
  if (vol) {
    add(25, `hajm ${vol[1]} m²`);
    if (parseFloat(vol[1].replace(',', '.')) >= 200) add(10, 'katta hajm');
  }
  if (/(bruschat|брусчат|plitka|плитк|trotuar|тротуар|granit|гранит|gilam|ковр|ковёр|bordyur|бордюр|travertin|травертин|stupen|ступен)/i.test(t)) add(15, 'mahsulot');
  if (/(narx|нарх|цен|qancha|қанча|сколько|стоим|прайс|price)/i.test(t)) add(10, 'narx so‘radi');
  if (/(hovli|ҳовли|uy\b|уй\b|obyekt|объект|дом|участ|dacha|дача|kafe|кафе|ofis|офис|restoran|ресторан|qurilish|строй|магазин|do‘kon|dokon)/i.test(t)) add(10, 'obyekt');
  if (/(toshkent|ташкент|viloyat|вилоят|област|район|tuman|туман|yetkaz|доставк|manzil|адрес|zamer|замер)/i.test(t)) add(5, 'joy/yetkazish');
  const n = (lead.messages || []).length;
  if (n >= 3) add(5, `${n} xabar`);
  if (n >= 6) add(5, 'faol suhbat');

  const cat = s >= 75 ? 'A' : s >= 55 ? 'B' : s >= 35 ? 'C' : s >= 15 ? 'D' : 'E';
  return { score: s, cat, why };
}

// ---------- Saqlash ----------
const readJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
function writeJSON(f, data) {
  const tmp = new URL(f.href + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, f);
}

let leads = readJSON(LEADS_F, null);
let expenses = readJSON(EXP_F, []);

// Eski leads.csv dan ko'chirish (oldingi versiya)
if (!leads) {
  leads = [];
  try {
    const rows = fs.readFileSync(new URL('./leads.csv', import.meta.url), 'utf8').split('\n').slice(1).filter(Boolean);
    for (const row of rows) {
      const c = row.split(';').map(x => x.replace(/^"|"$/g, ''));
      const lead = { n: +c[0], date: c[1], time: c[2], instagram: c[3], igId: null, phone: c[4] || null,
        telegram: c[5] || null, messages: [c[6]], status: 'yangi', amount: 0, catManual: false };
      Object.assign(lead, (({ score, cat }) => ({ score, cat }))(scoreLead(lead)));
      leads.push(lead);
    }
  } catch { /* eski fayl yo'q */ }
  writeJSON(LEADS_F, leads);
}
// ---------- Manbalar (qayerdan keldi): T1.. target, R1.. reels, S stories, O organik ----------
let sources = readJSON(SRC_F, {});
let dialogs = readJSON(DLG_F, {});
const BASE_SOURCES = {
  organic: { code: 'O', label: 'Organik (o‘zi yozgan)', type: 'organic' },
  story: { code: 'S', label: 'Stories javobi', type: 'story' },
  import: { code: 'I', label: 'Eski yozishmalar (import)', type: 'import' },
  legacy: { code: 'X', label: 'Manba aniqlanmagan (tizimgacha)', type: 'legacy' },
};
for (const [k, v] of Object.entries(BASE_SOURCES)) sources[k] ||= v;
// Eski lidlar: source = 'direct'/'import' → kodlarga
for (const l of leads) {
  if (l.source === 'import') l.source = 'I';
  else if (!l.source || l.source === 'direct') l.source = 'X';
}
writeJSON(SRC_F, sources);

/** Manba kaliti (masalan 'ad:123', 'reel:456') uchun qisqa kod: T1, R1 ... */
export function sourceCode(key, label, type) {
  if (sources[key]) {
    if (label && sources[key].label.startsWith('Reklama #')) { sources[key].label = label; writeJSON(SRC_F, sources); }
    return sources[key].code;
  }
  const prefix = type === 'ad' ? 'T' : type === 'reel' ? 'R' : 'M';
  const n = Object.values(sources).filter(s => s.code.startsWith(prefix) && /^\D\d+$/.test(s.code)).length + 1;
  sources[key] = { code: prefix + n, label: label || key, type, created: iso(tashNow()) };
  writeJSON(SRC_F, sources);
  return sources[key].code;
}
export const sourceList = () => Object.values(sources);
export const sourceByCode = (code) => Object.values(sources).find(s => s.code.toUpperCase() === String(code).toUpperCase()) || null;
export function renameSource(code, label) {
  const src = sourceByCode(code);
  if (!src) return null;
  src.label = label;
  writeJSON(SRC_F, sources);
  return src;
}

// ---------- Dialoglar: kim yozdi (raqam qoldirmagan bo'lsa ham) ----------
/** Mijozning birinchi xabari — dialog yaratiladi. Manba birinchi aniqlangan bo'yicha qoladi. */
export function recordDialog({ igId, username, source, follower }) {
  const t = tashNow();
  let d = dialogs[igId];
  if (!d) {
    d = dialogs[igId] = { igId, username: username || null, date: iso(t), time: hhmm(t), source: source || 'O', follower: follower ?? null };
  } else {
    if (source && source !== 'O' && d.source === 'O' && d.date === iso(t)) d.source = source; // keyin kelgan reklama belgisi
    if (follower != null) d.follower = follower;
    if (username && !d.username) d.username = username;
  }
  writeJSON(DLG_F, dialogs);
  return d;
}
export const getDialog = (igId) => dialogs[igId] || null;
export const dialogsIn = (from, to) => Object.values(dialogs).filter(d => d.date >= from && d.date <= to);

console.log(`Bazada lidlar: ${leads.length}, dialoglar: ${Object.keys(dialogs).length}, xarajat yozuvlari: ${expenses.length}`);

const save = () => writeJSON(LEADS_F, leads);
const keyIndex = () => new Set(leads.flatMap(l => [l.phone, l.telegram]).filter(Boolean));

// ---------- Lidlar ----------
/** Yangi lid. Dublikat bo'lsa null (telefon bor bo'lsa — telefon bo'yicha, bo'lmasa Telegram bo'yicha). */
export function recordLead({ phone, telegram, instagram, igId, messages, date, time, source, follower }) {
  const keys = keyIndex();
  if (phone ? keys.has(phone) : keys.has(telegram)) return null;
  const t = tashNow();
  const lead = {
    n: (leads.at(-1)?.n || 0) + 1, date: date || iso(t), time: time || hhmm(t), source: source || 'O', follower: follower ?? null,
    instagram, igId, phone: phone || null, telegram: telegram || null,
    messages: (messages || []).slice(-20), status: 'yangi', amount: 0, catManual: false,
  };
  Object.assign(lead, (({ score, cat }) => ({ score, cat }))(scoreLead(lead)));
  leads.push(lead);
  save();
  return lead;
}

/** Lid qoldirgan mijoz yana yozsa — xabarni qo'shamiz va bahoni yangilaymiz. */
export function appendMessage(igId, text) {
  const lead = [...leads].reverse().find(l => l.igId && l.igId === igId);
  if (!lead) return null;
  lead.messages = [...(lead.messages || []), text].slice(-20);
  if (!lead.catManual) Object.assign(lead, (({ score, cat }) => ({ score, cat }))(scoreLead(lead)));
  save();
  return lead;
}

export const getLead = (n) => leads.find(l => l.n === n) || null;

export function updateLead(n, patch) {
  const lead = getLead(n);
  if (!lead) return null;
  Object.assign(lead, patch);
  save();
  return lead;
}

export function query({ from, to, cat, status, text, source, follower } = {}) {
  const q = text?.toLowerCase().replace(/[\s\-()]/g, '');
  return leads.filter(l =>
    (!from || l.date >= from) && (!to || l.date <= to) &&
    (!cat || l.cat === cat) && (!status || l.status === status) &&
    (!source || String(l.source).toUpperCase() === source.toUpperCase()) &&
    (follower == null || l.follower === follower) &&
    (!q || [l.phone, l.telegram, l.instagram, ...(l.messages || [])].some(v => v && v.toLowerCase().replace(/[\s\-()]/g, '').includes(q)))
  );
}

// ---------- Marketing xarajatlari ----------
export function addExpense({ date, amount, channel, note }) {
  const e = { id: (expenses.at(-1)?.id || 0) + 1, date: date || iso(tashNow()), amount, channel: channel || 'instagram', note: note || '' };
  expenses.push(e);
  writeJSON(EXP_F, expenses);
  return e;
}
export function deleteExpense(id) {
  const before = expenses.length;
  expenses = expenses.filter(e => e.id !== id);
  writeJSON(EXP_F, expenses);
  return expenses.length < before;
}
export const expensesIn = (from, to) => expenses.filter(e => e.date >= from && e.date <= to);

// ---------- Excel (CSV) ----------
export function toCSV(list) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\s+/g, ' ')}"`;
  const head = ['№', 'Sana', 'Vaqt', 'Baho', 'Ball', 'Holat', 'Sotuv summasi', 'Manba', 'Manba nomi', 'Obunachi', 'Instagram', 'Telefon', 'Telegram', 'Yozishma'];
  const rows = list.map(l => [l.n, l.date, l.time, l.cat, l.score, l.status, l.amount || '', l.source, sourceByCode(l.source)?.label || '',
    l.follower == null ? '' : l.follower ? 'ha' : 'yo‘q', l.instagram, l.phone, l.telegram, (l.messages || []).join(' | ')]);
  return '﻿' + [head, ...rows].map(r => r.map(esc).join(';')).join('\n');
}
export function expensesCSV(list) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [['ID', 'Sana', 'Summa', 'Kanal', 'Izoh'], ...list.map(e => [e.id, e.date, e.amount, e.channel, e.note])]
    .map(r => r.map(esc).join(';')).join('\n');
}
