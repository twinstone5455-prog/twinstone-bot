// Telegram guruhidagi buyruqlar: hisobotlar, filtr, qidiruv, holat, sotuv, xarajat.
import { importHistory } from './history.js';
import {
  dialogsIn, sourceList, sourceByCode, renameSource,
  query, getLead, updateLead, addExpense, deleteExpense, expensesIn, toCSV, expensesCSV,
  tashNow, iso, STATUSES, CATS,
} from './leads.js';

const { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT } = process.env;
const API = `https://api.telegram.org/bot${TOKEN}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const som = (n) => Math.round(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' so‘m';
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const ICON = { yangi: '🆕', aktiv: '✅', sotildi: '💰', musor: '🗑' };

// ---------- Yuborish ----------
async function api(method, body) {
  return fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).catch(e => console.error('Telegram:', e.message));
}

// ---------- Tugmalar ----------
const btn = (text, data) => ({ text, callback_data: data });
const HOME = { inline_keyboard: [[btn('🏠 Menyu', 'menu')]] };
const MENU = { inline_keyboard: [
  [btn('📊 Hisobot', 'm:hisobot'), btn('🔎 Lidlar', 'm:lidlar')],
  [btn('📣 Xarajat qo‘shish', 'm:xarajat'), btn('📋 Xarajatlar', 'm:xarajatlar')],
  [btn('🧮 Hisob-kitob: 1 lid / 1 raqam narxi', 'm:hisob')],
  [btn('📍 Manbalar: Reels/Target', 'm:manbalar')],
  [btn('📁 Excel', 'm:excel'), btn('📖 Yordam', 'm:yordam')],
] };
const periodKb = (act) => ({ inline_keyboard: [
  [btn('Bugun', `${act}:bugun`), btn('Kecha', `${act}:kecha`), btn('Hafta', `${act}:hafta`)],
  [btn('Oy', `${act}:oy`), btn('O‘tgan oy', `${act}:otganoy`), btn('Kvartal', `${act}:kvartal`)],
  [btn('Yil', `${act}:yil`), btn('Hammasi', `${act}:hammasi`)],
  [btn('📅 Boshqa davr (16.10..bugun)', `p:${act}`), btn('🏠 Menyu', 'menu')],
] });
const filterKb = (act, period) => ({ inline_keyboard: [
  [btn('Hammasi', `${act}:${period}:-`)],
  ['A', 'B', 'C', 'D', 'E'].map(c => btn(c, `${act}:${period}:${c}`)),
  [btn('🆕 yangi', `${act}:${period}:yangi`), btn('✅ aktiv', `${act}:${period}:aktiv`)],
  [btn('💰 sotildi', `${act}:${period}:sotildi`), btn('🗑 musor', `${act}:${period}:musor`)],
  [btn('🏠 Menyu', 'menu')],
] });
export const leadKb = (n) => ({ inline_keyboard: [
  [btn('✅ Aktiv', `s:${n}:aktiv`), btn('🗑 Musor', `s:${n}:musor`), btn('💰 Sotildi', `s:${n}:sotildi`)],
  [btn('A', `c:${n}:A`), btn('B', `c:${n}:B`), btn('C', `c:${n}:C`), btn('D', `c:${n}:D`), btn('E', `c:${n}:E`)],
] });

// Javob kutadigan savollar (Telegram'da "reply") — privacy rejimida ham ishlaydi
const ASK_EXP = '📣 XARAJAT QO‘SHISH';
const ASK_SALE = '💰 SOTUV №';
const ASK_PERIOD = '📅 DAVR';
const ASK_CALC = '🧮 HISOB-KITOB';
const ACT_CMD = { h: '/hisobot', l: '/lidlar', e: '/excel', x: '/xarajatlar', sr: '/manbalar' };
const askReply = (text) => api('sendMessage', { chat_id: CHAT, text, reply_markup: { force_reply: true, selective: false } });

export async function send(text, markup = HOME) {
  if (!TOKEN || !CHAT) return;
  for (let i = 0; i < text.length; i += 4000) {
    const last = i + 4000 >= text.length;
    await api('sendMessage', { chat_id: CHAT, text: text.slice(i, i + 4000), disable_web_page_preview: true,
      ...(last && markup ? { reply_markup: markup } : {}) });
  }
}
async function sendFile(name, content, caption) {
  const form = new FormData();
  form.append('chat_id', CHAT);
  form.append('caption', caption);
  form.append('document', new Blob([content], { type: 'text/csv' }), name);
  await fetch(`${API}/sendDocument`, { method: 'POST', body: form }).catch(e => console.error('Telegram:', e.message));
}

// ---------- Davr (period) ----------
const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 16.10 → 2026-10-16, 16.10.2025 → 2025-10-16, bugun → bugungi sana
function normDate(x, t) {
  if (x === 'bugun') return iso(t);
  if (x === 'kecha') return iso(add(t, -1));
  const m = x.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (m) return `${m[3] || t.getFullYear()}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return x;
}

function parsePeriod(tok) {
  const t = tashNow(); const today = iso(t);
  let w = (tok || 'oy').toLowerCase();
  if (/^\d{1,2}\.\d{1,2}(\.\d{4})?$/.test(w)) w = normDate(w, t);
  if (/(\.\.|—|–|-|:)/.test(w) && !/^\d{4}-\d{2}(-\d{2})?$/.test(w)) {
    const parts = w.split(/\.\.|—|–|:|(?<=\d|n)-(?=\d|b|k)/).map(x => normDate(x.trim(), t));
    if (parts.length === 2 && DATE_RE.test(parts[0]) && DATE_RE.test(parts[1])) w = `${parts[0]}..${parts[1]}`;
  }
  const weekStart = add(t, -((t.getDay() + 6) % 7));
  const q0 = Math.floor(t.getMonth() / 3) * 3;
  const map = {
    bugun: [today, today, 'bugun'], kun: [today, today, 'bugun'],
    kecha: [iso(add(t, -1)), iso(add(t, -1)), 'kecha'],
    hafta: [iso(weekStart), today, 'shu hafta'],
    otganhafta: [iso(add(weekStart, -7)), iso(add(weekStart, -1)), 'o‘tgan hafta'],
    oy: [iso(new Date(t.getFullYear(), t.getMonth(), 1)), today, 'shu oy'],
    otganoy: [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0)), 'o‘tgan oy'],
    kvartal: [iso(new Date(t.getFullYear(), q0, 1)), today, `${q0 / 3 + 1}-kvartal`],
    yil: [`${t.getFullYear()}-01-01`, today, `${t.getFullYear()}-yil`],
    hammasi: ['2000-01-01', today, 'butun davr'],
  };
  if (map[w]) { const [from, to, label] = map[w]; return { from, to, label }; }
  if (/^\d{4}$/.test(w)) return { from: `${w}-01-01`, to: `${w}-12-31`, label: `${w}-yil` };
  if (/^\d{4}-\d{2}$/.test(w)) {
    const [y, m] = w.split('-').map(Number);
    return { from: `${w}-01`, to: iso(new Date(y, m, 0)), label: w };
  }
  if (DATE_RE.test(w)) return { from: w, to: w, label: w };
  const r = w.split(/\.\.|:/);
  if (r.length === 2 && DATE_RE.test(r[0]) && DATE_RE.test(r[1])) return { from: r[0], to: r[1], label: `${r[0]} — ${r[1]}` };
  return null;
}

/** Argumentlarni ajratish: davr, baho (A–E), holat — istalgan tartibda */
function parseFilters(args) {
  const f = { period: null, cat: null, status: null, source: null, follower: null, rest: [] };
  for (const a of args) {
    const p = parsePeriod(a);
    if (/^obunachi$/i.test(a)) f.follower = true;
    else if (/^obunasiz$/i.test(a)) f.follower = false;
    else if (!/^[a-e]$/i.test(a) && sourceByCode(a)) f.source = sourceByCode(a).code;
    else if (p && !f.period) f.period = p;
    else if (/^[a-e]$/i.test(a)) f.cat = a.toUpperCase();
    else if (STATUSES.includes(a.toLowerCase())) f.status = a.toLowerCase();
    else f.rest.push(a);
  }
  f.period ||= parsePeriod('oy');
  return f;
}

// Markaziy bank kursi (sana bo'yicha), zaxira: .env dagi USD_RATE
const rateCache = {};
async function usdRate(date) {
  if (rateCache[date]) return rateCache[date];
  try {
    const r = await fetch(`https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/${date}/`).then(x => x.json());
    const rate = parseFloat(r?.[0]?.Rate);
    if (rate > 0) return (rateCache[date] = rate);
  } catch { /* internet yo'q */ }
  const env = parseFloat(process.env.USD_RATE);
  return env > 0 ? env : null;
}
const usd = (n) => '$' + (Math.abs(n) < 100 ? (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '') : Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' '));
const usdSum = (list) => list.reduce((s, e) => s + (e.usd || 0), 0);

function parseAmount(tokens) {
  const s = tokens.join(' ').toLowerCase().replace(/,/g, '.');
  const m = s.match(/-?[\d\s.]*\d/);
  if (!m) return null;
  let n = parseFloat(m[0].replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, ''));
  if (/mln|млн|million/.test(s)) n *= 1e6;
  else if (/ming|тыс|k\b/.test(s)) n *= 1e3;
  return isFinite(n) ? n : null;
}

// ---------- Matnlar ----------
function line(l) {
  const who = l.phone || l.telegram || '';
  const msg = (l.messages?.[0] || '').slice(0, 40);
  return `№${l.n} · ${l.cat} · ${l.source || ''}${l.follower ? '👤' : ''} · ${ICON[l.status]}${l.status === 'sotildi' ? ' ' + som(l.amount) : ''} · ${l.date.slice(5)} · ${who} · ${l.instagram || ''}${msg ? ' — ' + msg : ''}`;
}

function report(period) {
  const list = query({ from: period.from, to: period.to });
  const exp = expensesIn(period.from, period.to);
  const spend = exp.reduce((s, e) => s + e.amount, 0);
  const sold = list.filter(l => l.status === 'sotildi');
  const revenue = sold.reduce((s, l) => s + (l.amount || 0), 0);
  const byCat = CATS.map(c => `${c}: ${list.filter(l => l.cat === c).length}`).join(' · ');
  const bySt = STATUSES.map(s => `${ICON[s]} ${s}: ${list.filter(l => l.status === s).length}`).join('\n');
  const channels = {};
  exp.forEach(e => { channels[e.channel] = (channels[e.channel] || 0) + e.amount; });
  const chText = Object.entries(channels).map(([c, a]) => `   ${c}: ${som(a)}`).join('\n');

  return `📊 HISOBOT — ${period.label}\n(${period.from} — ${period.to})\n\n` +
    `👥 Lidlar: ${list.length}\n${byCat}\n\n${bySt}\n\n` +
    `📣 Marketing xarajati: ${som(spend)}${usdSum(exp) ? ` (shundan ${usd(usdSum(exp))})` : ''}\n${chText ? chText + '\n' : ''}` +
    `💵 1 lid narxi: ${list.length ? som(spend / list.length) : '—'}\n\n` +
    `💰 Sotuvlar: ${sold.length} ta — ${som(revenue)}\n` +
    `🧾 O‘rtacha chek: ${sold.length ? som(revenue / sold.length) : '—'}\n` +
    `🎯 Konversiya (lid → sotuv): ${pct(sold.length, list.length)}\n` +
    `🧲 1 sotuv narxi: ${sold.length ? som(spend / sold.length) : '—'}\n` +
    `📈 ROMI: ${spend ? (((revenue - spend) / spend) * 100).toFixed(0) + '%' : '—'}\n\n` +
    `✍️ Directga yozganlar: ${dialogsIn(period.from, period.to).length}\n` +
    `👤 Obunachilar raqami: ${list.filter(l => l.follower === true).length} · obunasiz: ${list.filter(l => l.follower === false).length}\n` +
    `📍 Reels/Target bo‘yicha: /manbalar`;
}

// Manbalar: har bir reklama/reels bo'yicha — yozganlar, raqamlar, xarajat, narx
function sourcesReport(period) {
  const dlg = dialogsIn(period.from, period.to);
  const lds = query({ from: period.from, to: period.to });
  const exp = expensesIn(period.from, period.to);
  const spendOf = (code) => exp.filter(e => e.channel.toUpperCase() === code.toUpperCase()).reduce((s, e) => s + e.amount, 0);
  const codes = [...new Set([...dlg.map(d => d.source), ...lds.map(l => l.source), ...exp.map(e => e.channel.toUpperCase())])]
    .filter(c => sourceByCode(c));
  const rows = codes.map(code => {
    const src = sourceByCode(code);
    const wrote = dlg.filter(d => d.source === code).length;
    const nums = lds.filter(l => l.source === code);
    const fol = nums.filter(l => l.follower === true).length;
    const spend = spendOf(code);
    return { code, src, wrote, nums: nums.length, fol, spend };
  }).sort((a, b) => b.nums - a.nums || b.wrote - a.wrote);

  const target = rows.filter(r => r.src.type === 'ad');
  const tSpend = target.reduce((s, r) => s + r.spend, 0) + exp.filter(e => e.channel === 'target').reduce((s, e) => s + e.amount, 0);
  const tNums = target.reduce((s, r) => s + r.nums, 0);
  const tWrote = target.reduce((s, r) => s + r.wrote, 0);
  const folAll = lds.filter(l => l.follower === true).length;
  const nonFol = lds.filter(l => l.follower === false).length;

  const block = (r) => `${r.code} — ${r.src.label}\n` +
    `   ✍️ yozdi: ${r.wrote} · 📞 raqam: ${r.nums} (${pct(r.nums, r.wrote)}) · 👤 obunachi: ${r.fol}\n` +
    (r.spend ? `   💸 ${som(r.spend)} · 1 yozgan: ${r.wrote ? som(r.spend / r.wrote) : '—'} · 1 raqam: ${r.nums ? som(r.spend / r.nums) : '—'}\n` : '');

  return `📍 MANBALAR — ${period.label}\n(${period.from} — ${period.to})\n\n` +
    `🎯 TARGET jami: ${som(tSpend)} sarflandi${usdSum(exp.filter(e => e.channel === 'target' || sourceByCode(e.channel)?.type === 'ad')) ? ` (${usd(usdSum(exp.filter(e => e.channel === 'target' || sourceByCode(e.channel)?.type === 'ad')))})` : ''}\n` +
    `   ✍️ yozdi: ${tWrote} · 📞 raqam: ${tNums}\n` +
    `   1 raqam narxi: ${tNums ? som(tSpend / tNums) : '—'}\n\n` +
    `👤 Obunachilar qoldirgan raqamlar: ${folAll}\n` +
    `🙋 Obuna bo‘lmaganlar: ${nonFol}${lds.length - folAll - nonFol ? ` · noma’lum: ${lds.length - folAll - nonFol}` : ''}\n\n` +
    (rows.length ? rows.map(block).join('\n') : 'Hali ma’lumot yo‘q') +
    `\n\nXarajat yozish: /xarajat 2 mln T1 · Nom berish: /manba_nom T1 Bruschatka aksiya`;
}

// Hisob-kitob: sarf / yozganlar va sarf / raqam qoldirganlar
async function calcReport(period, money) {
  const dlg = dialogsIn(period.from, period.to);
  const lds = query({ from: period.from, to: period.to });
  // Yozganlar = dialoglar + (dialogi yo'q eski lidlar)
  const ids = new Set(dlg.map(d => String(d.igId)));
  const extra = lds.filter(l => !l.igId || !ids.has(String(l.igId))).length;
  const writers = ids.size + extra;
  const nums = lds.length;

  let soms, usds, rate = await usdRate(iso(tashNow()));
  if (money) { ({ soms, usds } = money); if (usds && !soms) soms = rate ? usds * rate : null; }
  else {
    const exp = expensesIn(period.from, period.to);
    soms = exp.reduce((s, e) => s + e.amount, 0);
    usds = rate ? soms / rate : null;
  }
  const both = (somV) => somV == null ? '—' : (rate ? `${usd(somV / rate)} (≈ ${som(somV)})` : som(somV));
  const per = (n) => (n && soms ? both(soms / n) : '—');
  const ab = lds.filter(l => l.cat === 'A' || l.cat === 'B').length;
  const fol = lds.filter(l => l.follower === true).length;

  return `🧮 HISOB-KITOB — ${period.label}\n(${period.from} — ${period.to})\n\n` +
    `💸 Sarflangan: ${money?.usds ? usd(money.usds) + (soms ? ` (≈ ${som(soms)})` : '') : both(soms)}\n` +
    (money ? '' : `   (/xarajat bilan yozilgan xarajatlar yig‘indisi)\n`) +
    `\n1️⃣ BARCHA YOZGANLAR BO‘YICHA\n` +
    `✍️ Directga yozdi: ${writers} ta\n` +
    `💵 1 lid narxi: ${per(writers)}\n` +
    `\n2️⃣ RAQAM QOLDIRGANLAR BO‘YICHA\n` +
    `📞 Raqam qoldirdi: ${nums} ta (${pct(nums, writers)} yozganlardan)\n` +
    `💵 1 raqam narxi: ${per(nums)}\n` +
    `\n⭐ Sifatli raqamlar (A+B): ${ab} ta → 1 tasi ${per(ab)}\n` +
    `👤 Obunachilar raqami: ${fol} ta` +
    (rate ? `\n\nKurs: 1$ = ${rate} so‘m (MB)` : '');
}

function card(l) {
  return `🧾 Lid №${l.n} — baho ${l.cat} (${l.score} ball${l.catManual ? ', qo‘lda' : ''})\n` +
    `Sana: ${l.date} ${l.time}\nHolat: ${ICON[l.status]} ${l.status}${l.amount ? ' — ' + som(l.amount) : ''}\n` +
    (l.instagram ? `Instagram: ${l.instagram}${l.instagram.startsWith('@') ? ' — https://instagram.com/' + l.instagram.slice(1) : ''}\n` : '') +
    `📍 Manba: ${l.source || '—'} ${sourceByCode(l.source)?.label ? '— ' + sourceByCode(l.source).label : ''}\n` +
    `👤 Obunachi: ${l.follower == null ? 'noma’lum' : l.follower ? 'ha' : 'yo‘q'}\n` +
    (l.phone ? `📞 ${l.phone}\n` : '') +
    (l.telegram ? `✈️ ${l.telegram} — https://t.me/${l.telegram.slice(1)}\n` : '') +
    `\nYozishma:\n${(l.messages || []).slice(-10).map(m => '• ' + m).join('\n')}\n\n` +
    `/aktiv ${l.n} · /musor ${l.n} · /sotuv ${l.n} 12000000 · /baho ${l.n} A`;
}

const HELP = `📖 BUYRUQLAR

🏠 /menu — tugmali menyu

📊 Hisobot (lid, A–E, holat, xarajat, 1 lid narxi, o‘rtacha chek, konversiya):
/hisobot — shu oy
/hisobot bugun | kecha | hafta | otganhafta | oy | otganoy | kvartal | yil | hammasi
/hisobot 2026-10 · /hisobot 2026 · /hisobot 2026-10-01..2026-10-15

🔎 Lidlarni filtrlash (istalgan tartibda):
/lidlar oy B aktiv
/lidlar hafta musor
/lidlar yil A
/lid 884 — bitta lid kartasi
/qidir 901234567 — telefon, @telegram yoki so‘z bo‘yicha

✏️ Lidni belgilash:
/aktiv 884 · /musor 884 · /yangi 884
/sotuv 884 12000000 (yoki 12 mln)
/baho 884 A

🧮 Hisob-kitob (1 lid va 1 raqam narxi):
/hisob 16.10..27.10 1000$ — shu davrda 1000$ ketdi:
   1) yozganlar soniga bo‘lib — 1 lid narxi
   2) raqam qoldirganlarga bo‘lib — 1 raqam narxi
/hisob oy — summasiz: /xarajat yozuvlaridan hisoblaydi

📍 Reels / Target (qayerdan keldi):
/manbalar oy — har bir reklama (T1, T2…) va reels (R1…) bo‘yicha:
   nechta yozdi, nechta raqam, obunachilar, sarf, 1 raqam narxi
/manba_nom T1 Bruschatka aksiya — kodga nom berish
/lidlar oy T1 — shu reklamadan kelgan raqamlar
/lidlar oy obunachi — obunachilar qoldirgan raqamlar

📣 Marketing xarajati (target uchun kod bilan):
/xarajat 2 mln T1 — T1 reklamaga sarf
/xarajat 600$ T1 — dollarda (MB kursi bo‘yicha so‘mga o‘tkaziladi)
/xarajat 600$ target 16.10 — sana bilan
/xarajat 500000 instagram
/xarajat 1.5 mln target 2026-10-01 bannerlar
/xarajatlar oy — ro‘yxat
/xarajat_ochir 12 — xato yozuvni o‘chirish

📁 Excel:
/excel oy B aktiv — filtrlangan lidlar
/excel_xarajat yil — xarajatlar

📅 Istalgan davr: 16.10..bugun · 01.10..15.10 · 2026-10-16..2026-10-27
   masalan: /hisobot 16.10..bugun · /lidlar 16.10..bugun A

⬇️ Eski yozishmalarni yuklash:
/import 16.10 — 16-oktyabrdan beri Direct'dagi raqamlarni bazaga qo‘shadi`;

// ---------- Buyruqlar ----------
async function handle(text) {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const num = parseInt(args[0], 10);

  switch (cmd) {
    case '/start': case '/menu': case '/menyu':
      return send('🏠 Menyu — kerakli bo‘limni tanlang:', MENU);

    case '/yordam': case '/help':
      return send(HELP);

    case '/hisobot': case '/stats': case '/statistika': {
      if (!args.length) return send('📊 Qaysi davr uchun hisobot?', periodKb('h'));
      const p = parsePeriod(args[0]);
      return send(p ? report(p) : 'Davr tushunarsiz. Masalan: /hisobot oy yoki /hisobot 2026-10');
    }

    case '/lidlar': {
      if (!args.length) return send('🔎 Qaysi davrdagi lidlar?', periodKb('l'));
      const f = parseFilters(args);
      const list = query({ from: f.period.from, to: f.period.to, cat: f.cat, status: f.status, source: f.source, follower: f.follower });
      const title = `🔎 ${f.period.label}${f.cat ? ' · ' + f.cat : ''}${f.status ? ' · ' + f.status : ''}${f.source ? ' · ' + f.source : ''}${f.follower != null ? (f.follower ? ' · obunachi' : ' · obunasiz') : ''}: ${list.length} ta lid`;
      if (!list.length) return send(title);
      await send(title + '\n\n' + list.slice(-30).reverse().map(line).join('\n') +
        (list.length > 30 ? `\n\n…oxirgi 30 tasi ko‘rsatildi. Hammasi Excel faylda 👇` : ''));
      if (list.length > 30) await sendFile(`lidlar-${f.period.from}_${f.period.to}.csv`, toCSV(list), title);
      return;
    }

    case '/lid': {
      const l = getLead(num);
      return send(l ? card(l) : `№${args[0] || '?'} lid topilmadi`);
    }

    case '/qidir': {
      if (!args.length) return send('Masalan: /qidir 901234567 yoki /qidir @username');
      const list = query({ text: args.join(' ') });
      return send(list.length ? `🔎 Topildi: ${list.length}\n\n` + list.slice(-30).reverse().map(line).join('\n') : 'Hech narsa topilmadi');
    }

    case '/aktiv': case '/musor': case '/yangi': {
      const l = updateLead(num, { status: cmd.slice(1), ...(cmd !== '/sotuv' ? { amount: 0 } : {}) });
      return send(l ? `№${l.n} → ${ICON[l.status]} ${l.status}` : 'Lid topilmadi. Masalan: /aktiv 884');
    }

    case '/sotuv': {
      const amount = parseAmount(args.slice(1));
      if (!getLead(num) || !amount) return send('Masalan: /sotuv 884 12000000 yoki /sotuv 884 12 mln');
      const l = updateLead(num, { status: 'sotildi', amount });
      return send(`№${l.n} → 💰 sotildi — ${som(amount)}`);
    }

    case '/baho': {
      const c = (args[1] || '').toUpperCase();
      if (!getLead(num) || !CATS.includes(c)) return send('Masalan: /baho 884 A  (A, B, C, D yoki E)');
      const l = updateLead(num, { cat: c, catManual: true });
      return send(`№${l.n} → baho ${c}`);
    }

    case '/xarajat': {
      const nums = [], rest = [];
      for (const a of args) (rest.length === 0 && /^(-?\$?[\d.,]+\$?|\$|usd|dollar|долл?ар\S*|mln|млн|ming|тыс|k)$/i.test(a) ? nums : rest).push(a);
      const isUsd = /\$|usd|dollar|доллар/i.test(nums.join(' '));
      let amount = parseAmount(nums.map(x => x.replace(/\$/g, '')));
      let kurs = null;
      const ki = rest.findIndex(x => /^kurs/i.test(x));
      if (ki >= 0) { kurs = parseFloat((rest[ki].replace(/^kurs=?/i, '') || rest[ki + 1] || '').replace(/\s/g, '')); rest.splice(ki, rest[ki].length > 4 ? 1 : 2); }
      if (!args.length) return askReply(`${ASK_EXP}\n\nShu xabarga javob qilib summa va kanalni yozing:\n500000 instagram\n1.5 mln target\n2000000 instagram 2026-10-01 izoh`);
      if (!amount) return send('Masalan: /xarajat 500000 instagram  yoki  /xarajat 1.5 mln target 2026-10-01');
      let channel = rest[0] && !DATE_RE.test(normDate(rest[0], tashNow())) ? rest.shift().toLowerCase() : 'instagram';
      if (sourceByCode(channel)) channel = sourceByCode(channel).code;
      if (rest[0]) rest[0] = normDate(rest[0], tashNow());
      const date = rest[0] && DATE_RE.test(rest[0]) ? rest.shift() : undefined;
      let usdAmount = null;
      if (isUsd) {
        const rate = kurs || await usdRate(date || iso(tashNow()));
        if (!rate) return send('Dollar kursini olib bo‘lmadi. Kursni o‘zingiz yozing:\n/xarajat 600$ T1 kurs 12800');
        usdAmount = amount; amount = Math.round(amount * rate); kurs = rate;
      }
      const e = addExpense({ amount, channel, date, note: rest.join(' '), usd: usdAmount, rate: kurs });
      return send(`📣 Xarajat №${e.id} yozildi: ${e.usd ? usd(e.usd) + ' × ' + e.rate + ' = ' : ''}${som(e.amount)} · ${e.channel} · ${e.date}${e.note ? ' · ' + e.note : ''}\n\nXato bo‘lsa: /xarajat_ochir ${e.id}`);
    }

    case '/xarajatlar': {
      const p = parsePeriod(args[0] || 'oy') || parsePeriod('oy');
      const list = expensesIn(p.from, p.to);
      const sum = list.reduce((s, e) => s + e.amount, 0);
      return send(`📣 Xarajatlar — ${p.label}: ${som(sum)}\n\n` +
        (list.map(e => `№${e.id} · ${e.date} · ${e.usd ? usd(e.usd) + ' = ' : ''}${som(e.amount)} · ${e.channel}${e.note ? ' · ' + e.note : ''}`).join('\n') || 'Yozuv yo‘q') +
        (usdSum(list) ? `\n\nShundan dollarda: ${usd(usdSum(list))}` : '') + '\n\nO‘chirish: /xarajat_ochir №');
    }

    case '/hisob': case '/hisobkitob': case '/xisob': {
      if (!args.length) return askReply(`${ASK_CALC}\n\nShu xabarga javob qilib davr va summani yozing:\n16.10..27.10 1000$\n01.10..bugun 12 mln\noy  (summasiz — /xarajat yozuvlaridan oladi)`);
      // "16.10 - 27.10", "16.10 dan 27.10 gacha" → "16.10..27.10"
      const D = '(\\d{1,2}\\.\\d{1,2}(?:\\.\\d{4})?|\\d{4}-\\d{2}-\\d{2}|bugun)';
      const joined = args.join(' ').replace(new RegExp(D + '\\s*(?:dan)?\\s*(?:\\.\\.|—|–|-)?\\s*' + D + '(?:\\s*gacha)?', 'i'), '$1..$2');
      const parts = joined.trim().split(/\s+/);
      const period = parsePeriod(parts[0]);
      if (!period) return send('Masalan: /hisob 16.10..27.10 1000$  yoki  /hisob oy 12 mln');
      const rest = parts.slice(1);
      let money = null;
      if (rest.length) {
        const isUsd = /\$|usd|dollar|доллар/i.test(rest.join(' '));
        const amount = parseAmount(rest.map(x => x.replace(/\$/g, '')));
        if (!amount) return send('Summani tushunmadim. Masalan: /hisob 16.10..27.10 1000$');
        money = isUsd ? { usds: amount } : { soms: amount };
      }
      return send(await calcReport(period, money));
    }

    case '/manbalar': case '/manba': {
      if (!args.length) return send('📍 Qaysi davr uchun manbalar (Reels/Target)?', periodKb('sr'));
      const p = parsePeriod(args.join('')) || parsePeriod('oy');
      return send(sourcesReport(p));
    }

    case '/manba_nom': {
      const code = args[0]; const name = args.slice(1).join(' ');
      const src = code && name ? renameSource(code, name) : null;
      return send(src ? `${src.code} → «${src.label}»` : 'Masalan: /manba_nom T1 Bruschatka aksiya\nKodlar: ' + sourceList().map(x => x.code).join(', '));
    }

    case '/import': {
      const t = tashNow();
      const from = normDate(args[0] || '', t);
      if (!DATE_RE.test(from)) return send('Masalan: /import 16.10  — shu sanadan bugungacha Direct yozishmalarini yuklaydi');
      await send(`⏳ ${from} dan beri Direct yozishmalarini yuklayapman… Bir necha daqiqa kutib turing.`, null);
      const r = await importHistory(from);
      return send(`✅ Import tugadi (${from} — ${iso(t)})\n\n` +
        `Ko‘rilgan suhbatlar: ${r.conversations}\n` +
        `Yozgan odamlar (shu davrda): ${r.writers}\n` +
        `Telefon/Telegram topilgan: ${r.withContact}\n` +
        `Yangi lid sifatida qo‘shildi: ${r.added}\n` +
        `Dublikat (oldin bor edi): ${r.duplicates}` +
        (r.errors ? `\nXatoliklar: ${r.errors}` : '') +
        `\n\nHisobot: /hisobot ${from}..bugun`);
    }

    case '/xarajat_ochir':
      return send(deleteExpense(num) ? `Xarajat №${num} o‘chirildi` : 'Topilmadi. Masalan: /xarajat_ochir 12');

    case '/excel': case '/export': {
      if (!args.length) return send('📁 Qaysi davr uchun Excel?', periodKb('e'));
      const f = parseFilters(args);
      const list = query({ from: f.period.from, to: f.period.to, cat: f.cat, status: f.status, source: f.source, follower: f.follower });
      return sendFile(`lidlar-${f.period.from}_${f.period.to}.csv`, toCSV(list),
        `📁 Lidlar: ${f.period.label}${f.cat ? ' · ' + f.cat : ''}${f.status ? ' · ' + f.status : ''}${f.source ? ' · ' + f.source : ''}${f.follower != null ? (f.follower ? ' · obunachi' : ' · obunasiz') : ''} — ${list.length} ta`);
    }

    case '/excel_xarajat': {
      const p = parsePeriod(args[0] || 'yil') || parsePeriod('yil');
      const list = expensesIn(p.from, p.to);
      return sendFile(`xarajatlar-${p.from}_${p.to}.csv`, expensesCSV(list), `📁 Xarajatlar: ${p.label} — ${list.length} ta`);
    }
  }
}

// ---------- Tugma bosilganda ----------
async function onButton(q) {
  api('answerCallbackQuery', { callback_query_id: q.id });
  const [act, a, b] = q.data.split(':');
  const who = q.from.first_name || q.from.username || '';
  switch (act) {
    case 'menu': return send('🏠 Menyu — kerakli bo‘limni tanlang:', MENU);
    case 'm':
      if (a === 'hisobot') return send('📊 Qaysi davr uchun hisobot?', periodKb('h'));
      if (a === 'lidlar') return send('🔎 Qaysi davrdagi lidlar?', periodKb('l'));
      if (a === 'excel') return send('📁 Qaysi davr uchun Excel?', periodKb('e'));
      if (a === 'xarajatlar') return send('📋 Qaysi davr xarajatlari?', periodKb('x'));
      if (a === 'xarajat') return handle('/xarajat');
      if (a === 'hisob') return handle('/hisob');
      if (a === 'manbalar') return send('📍 Qaysi davr uchun manbalar (Reels/Target)?', periodKb('sr'));
      if (a === 'yordam') return handle('/yordam');
      return;
    case 'p': return askReply(`${ASK_PERIOD} (${a})\n\nShu xabarga javob qilib davrni yozing:\n16.10..bugun\n01.10..15.10\n2026-10`);
    case 'h': return handle(`/hisobot ${a}`);
    case 'x': return handle(`/xarajatlar ${a}`);
    case 'sr': return handle(`/manbalar ${a}`);
    case 'l': return b ? handle(`/lidlar ${a} ${b === '-' ? '' : b}`) : send('Qaysi lidlar?', filterKb('l', a));
    case 'e': return b ? handle(`/excel ${a} ${b === '-' ? '' : b}`) : send('Qaysi lidlar Excel’ga?', filterKb('e', a));
    case 's': {
      if (b === 'sotildi') return askReply(`${ASK_SALE}${a}\n\nShu xabarga javob qilib sotuv summasini yozing:\n12000000  yoki  12 mln`);
      const l = updateLead(+a, { status: b, amount: 0 });
      return l && send(`№${l.n} → ${ICON[b]} ${b} (${who})`, null);
    }
    case 'c': {
      const l = updateLead(+a, { cat: b, catManual: true });
      return l && send(`№${l.n} → baho ${b} (${who})`, null);
    }
  }
}

// Bot savoliga javob (xarajat yoki sotuv summasi)
async function onReply(m) {
  const q = m.reply_to_message.text || '';
  if (q.startsWith(ASK_CALC)) return handle(`/hisob ${m.text.trim()}`);
  if (q.startsWith(ASK_PERIOD)) {
    const act = (q.match(/\((\w+)\)/) || [])[1] || 'h';
    return handle(`${ACT_CMD[act]} ${m.text.trim().replace(/\s+/g, '')}`);
  }
  if (q.startsWith(ASK_EXP)) return handle(`/xarajat ${m.text}`);
  if (q.startsWith(ASK_SALE)) {
    const n = parseInt(q.slice(ASK_SALE.length), 10);
    return handle(`/sotuv ${n} ${m.text}`);
  }
}

// ---------- Ishga tushirish ----------
async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}&allowed_updates=["message","callback_query"]`);
      const data = await res.json();
      for (const u of data.result || []) {
        offset = u.update_id + 1;
        const m = u.message;
        const q = u.callback_query;
        if (q && String(q.message?.chat.id) === String(CHAT)) {
          await onButton(q).catch(e => send('Xatolik: ' + e.message));
        } else if (m?.text && String(m.chat.id) === String(CHAT)) {
          if (m.reply_to_message?.from?.is_bot) await onReply(m).catch(e => send('Xatolik: ' + e.message));
          else if (m.text.startsWith('/')) await handle(m.text).catch(e => send('Xatolik: ' + e.message));
        }
      }
    } catch (e) {
      console.error('Telegram poll:', e.message);
      await sleep(5000);
    }
  }
}

function scheduler() {
  let last = '';
  setInterval(async () => {
    const t = tashNow();
    if (t.getHours() !== 9 || t.getMinutes() !== 0 || last === iso(t)) return;
    last = iso(t);
    if (t.getDate() === 1) {
      const p = parsePeriod('otganoy');
      await send('🗓 OYLIK HISOBOT\n\n' + report(p));
      await sendFile(`lidlar-${p.from}_${p.to}.csv`, toCSV(query(p)), `📁 ${p.label}: barcha lidlar`);
      if (t.getMonth() % 3 === 0) await send('🗓 KVARTAL HISOBOTI\n\n' + report({
        from: iso(new Date(t.getFullYear(), t.getMonth() - 3, 1)), to: p.to, label: 'o‘tgan kvartal' }));
      if (t.getMonth() === 0) await send('🗓 YILLIK HISOBOT\n\n' + report(parsePeriod(String(t.getFullYear() - 1))));
    } else if (t.getDay() === 1) {
      await send('🗓 HAFTALIK HISOBOT\n\n' + report(parsePeriod('otganhafta')));
    }
  }, 60 * 1000);
}

export function startTelegram() {
  if (!TOKEN || !CHAT) { console.log('Telegram sozlanmagan — buyruqlar o‘chiq'); return; }
  api('setMyCommands', { commands: [
    { command: 'menu', description: '🏠 Menyu' },
    { command: 'hisobot', description: '📊 Hisobot: lid, xarajat, o‘rtacha chek' },
    { command: 'hisob', description: '🧮 1 lid va 1 raqam narxi (16.10..27.10 1000$)' },
    { command: 'lidlar', description: '🔎 Lidlarni filtrlash' },
    { command: 'xarajat', description: '📣 Xarajat qo‘shish' },
    { command: 'xarajatlar', description: '📋 Xarajatlar ro‘yxati' },
    { command: 'excel', description: '📁 Excel fayl' },
    { command: 'qidir', description: '🔎 Telefon yoki @telegram bo‘yicha qidirish' },
    { command: 'yordam', description: '📖 Barcha buyruqlar' },
  ] });
  poll();
  scheduler();
  console.log('Telegram buyruqlari yoqildi');
}

export const _test = { handle, onButton, onReply, parsePeriod, parseAmount, report };
