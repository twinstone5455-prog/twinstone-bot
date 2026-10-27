// Распознавание контактов, подсчёт заявок и защита от дубликатов.
// Все заявки хранятся в leads.csv рядом с ботом — переживают перезапуск.
import fs from 'fs';

const FILE = new URL('./leads.csv', import.meta.url);
const HEADER = 'n;date;time;instagram;phone;telegram;message\n';
const TZ = 'Asia/Tashkent';

// ---------- Распознавание ----------
const TG_RE = /(?:t\.me\/|telegram\.me\/|@)([a-z][a-z0-9_]{4,31})/i;

function normalizePhone(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length === 9) return '+998' + d;                         // 90 123 45 67
  if (d.length === 12 && d.startsWith('998')) return '+' + d;    // +998 90 123 45 67
  if (d.length === 10 && d.startsWith('8')) return '+998' + d.slice(1); // 8 90 1234567
  if (d.length === 11 && d.startsWith('7')) return '+' + d;      // Россия/Казахстан
  if (d.length >= 10 && d.length <= 13) return '+998' + d.slice(-9); // лишние цифры спереди
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

// ---------- Хранилище ----------
const keys = new Set();          // уже полученные телефоны и Telegram
const byDay = new Map();         // дата -> количество
let total = 0;

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // 2026-10-27
const now = () => new Date().toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\s+/g, ' ')}"`;

try {
  const rows = fs.readFileSync(FILE, 'utf8').split('\n').slice(1).filter(Boolean);
  for (const row of rows) {
    const cols = row.split(';').map(c => c.replace(/^"|"$/g, ''));
    const [, date, , , phone, telegram] = cols;
    if (phone) keys.add(phone);
    if (telegram) keys.add(telegram.toLowerCase());
    byDay.set(date, (byDay.get(date) || 0) + 1);
    total++;
  }
  console.log(`Заявок в базе: ${total}`);
} catch {
  fs.writeFileSync(FILE, HEADER);
}

/**
 * Записывает контакт. Возвращает null, если это дубликат
 * (номер телефона уже был; без номера — Telegram уже был), иначе номер заявки и счётчики.
 */
export function recordLead({ phone, telegram, instagram, message }) {
  if (phone ? keys.has(phone) : keys.has(telegram)) return null;

  [phone, telegram].filter(Boolean).forEach(k => keys.add(k));
  total++;
  const d = today();
  byDay.set(d, (byDay.get(d) || 0) + 1);

  const line = [total, d, now(), instagram, phone, telegram, message].map(csv).join(';') + '\n';
  fs.appendFileSync(FILE, line);

  return { n: total, today: byDay.get(d), total };
}

// ---------- Статистика по периодам ----------
function sumRange(from, to) { // включительно, строки YYYY-MM-DD
  let s = 0;
  for (const [d, c] of byDay) if (d >= from && d <= to) s += c;
  return s;
}
function tashkentNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}
const addDays = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };

export function periodStats() {
  const t = tashkentNow();
  const dow = (t.getDay() + 6) % 7;                 // 0 = понедельник
  const weekStart = addDays(t, -dow);
  const monthStart = new Date(t.getFullYear(), t.getMonth(), 1);
  const prevWeekStart = addDays(weekStart, -7);
  const prevMonthStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const prevMonthEnd = addDays(monthStart, -1);
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const todayS = iso(t);
  return {
    today: sumRange(todayS, todayS),
    week: sumRange(iso(weekStart), todayS),
    month: sumRange(iso(monthStart), todayS),
    prevWeek: sumRange(iso(prevWeekStart), iso(addDays(weekStart, -1))),
    prevWeekRange: `${iso(prevWeekStart)} — ${iso(addDays(weekStart, -1))}`,
    prevMonth: sumRange(iso(prevMonthStart), iso(prevMonthEnd)),
    prevMonthName: prevMonthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    total,
    now: t,
  };
}

export const LEADS_FILE = FILE;
