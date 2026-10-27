// Telegram guruhidagi buyruqlar: hisobotlar, filtr, qidiruv, holat, sotuv, xarajat.
import {
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
export async function send(text) {
  if (!TOKEN || !CHAT) return;
  for (let i = 0; i < text.length; i += 4000) {
    await fetch(`${API}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: text.slice(i, i + 4000), disable_web_page_preview: true }),
    }).catch(e => console.error('Telegram:', e.message));
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

function parsePeriod(tok) {
  const t = tashNow(); const today = iso(t);
  const w = (tok || 'oy').toLowerCase();
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
  const f = { period: null, cat: null, status: null, rest: [] };
  for (const a of args) {
    const p = parsePeriod(a);
    if (p && !f.period) f.period = p;
    else if (/^[a-e]$/i.test(a)) f.cat = a.toUpperCase();
    else if (STATUSES.includes(a.toLowerCase())) f.status = a.toLowerCase();
    else f.rest.push(a);
  }
  f.period ||= parsePeriod('oy');
  return f;
}

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
  return `№${l.n} · ${l.cat} · ${ICON[l.status]}${l.status === 'sotildi' ? ' ' + som(l.amount) : ''} · ${l.date.slice(5)} · ${who} · ${l.instagram || ''}${msg ? ' — ' + msg : ''}`;
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
    `📣 Marketing xarajati: ${som(spend)}\n${chText ? chText + '\n' : ''}` +
    `💵 1 lid narxi: ${list.length ? som(spend / list.length) : '—'}\n\n` +
    `💰 Sotuvlar: ${sold.length} ta — ${som(revenue)}\n` +
    `🧾 O‘rtacha chek: ${sold.length ? som(revenue / sold.length) : '—'}\n` +
    `🎯 Konversiya (lid → sotuv): ${pct(sold.length, list.length)}\n` +
    `🧲 1 sotuv narxi: ${sold.length ? som(spend / sold.length) : '—'}\n` +
    `📈 ROMI: ${spend ? (((revenue - spend) / spend) * 100).toFixed(0) + '%' : '—'}`;
}

function card(l) {
  return `🧾 Lid №${l.n} — baho ${l.cat} (${l.score} ball${l.catManual ? ', qo‘lda' : ''})\n` +
    `Sana: ${l.date} ${l.time}\nHolat: ${ICON[l.status]} ${l.status}${l.amount ? ' — ' + som(l.amount) : ''}\n` +
    (l.instagram ? `Instagram: ${l.instagram}${l.instagram.startsWith('@') ? ' — https://instagram.com/' + l.instagram.slice(1) : ''}\n` : '') +
    (l.phone ? `📞 ${l.phone}\n` : '') +
    (l.telegram ? `✈️ ${l.telegram} — https://t.me/${l.telegram.slice(1)}\n` : '') +
    `\nYozishma:\n${(l.messages || []).slice(-10).map(m => '• ' + m).join('\n')}\n\n` +
    `/aktiv ${l.n} · /musor ${l.n} · /sotuv ${l.n} 12000000 · /baho ${l.n} A`;
}

const HELP = `📖 BUYRUQLAR

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

📣 Marketing xarajati:
/xarajat 500000 instagram
/xarajat 1.5 mln target 2026-10-01 bannerlar
/xarajatlar oy — ro‘yxat
/xarajat_ochir 12 — xato yozuvni o‘chirish

📁 Excel:
/excel oy B aktiv — filtrlangan lidlar
/excel_xarajat yil — xarajatlar`;

// ---------- Buyruqlar ----------
async function handle(text) {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const num = parseInt(args[0], 10);

  switch (cmd) {
    case '/start': case '/yordam': case '/help':
      return send(HELP);

    case '/hisobot': case '/stats': case '/statistika': {
      const p = parsePeriod(args[0] || 'oy');
      return send(p ? report(p) : 'Davr tushunarsiz. Masalan: /hisobot oy yoki /hisobot 2026-10');
    }

    case '/lidlar': {
      const f = parseFilters(args);
      const list = query({ from: f.period.from, to: f.period.to, cat: f.cat, status: f.status });
      const title = `🔎 ${f.period.label}${f.cat ? ' · ' + f.cat : ''}${f.status ? ' · ' + f.status : ''}: ${list.length} ta lid`;
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
      for (const a of args) (rest.length === 0 && /^(-?[\d.,]+|mln|млн|ming|тыс|k)$/i.test(a) ? nums : rest).push(a);
      const amount = parseAmount(nums);
      if (!amount) return send('Masalan: /xarajat 500000 instagram  yoki  /xarajat 1.5 mln target 2026-10-01');
      const channel = rest[0] && !DATE_RE.test(rest[0]) ? rest.shift().toLowerCase() : 'instagram';
      const date = rest[0] && DATE_RE.test(rest[0]) ? rest.shift() : undefined;
      const e = addExpense({ amount, channel, date, note: rest.join(' ') });
      return send(`📣 Xarajat №${e.id} yozildi: ${som(e.amount)} · ${e.channel} · ${e.date}${e.note ? ' · ' + e.note : ''}`);
    }

    case '/xarajatlar': {
      const p = parsePeriod(args[0] || 'oy') || parsePeriod('oy');
      const list = expensesIn(p.from, p.to);
      const sum = list.reduce((s, e) => s + e.amount, 0);
      return send(`📣 Xarajatlar — ${p.label}: ${som(sum)}\n\n` +
        (list.map(e => `№${e.id} · ${e.date} · ${som(e.amount)} · ${e.channel}${e.note ? ' · ' + e.note : ''}`).join('\n') || 'Yozuv yo‘q'));
    }

    case '/xarajat_ochir':
      return send(deleteExpense(num) ? `Xarajat №${num} o‘chirildi` : 'Topilmadi. Masalan: /xarajat_ochir 12');

    case '/excel': case '/export': {
      const f = parseFilters(args);
      const list = query({ from: f.period.from, to: f.period.to, cat: f.cat, status: f.status });
      return sendFile(`lidlar-${f.period.from}_${f.period.to}.csv`, toCSV(list),
        `📁 Lidlar: ${f.period.label}${f.cat ? ' · ' + f.cat : ''}${f.status ? ' · ' + f.status : ''} — ${list.length} ta`);
    }

    case '/excel_xarajat': {
      const p = parsePeriod(args[0] || 'yil') || parsePeriod('yil');
      const list = expensesIn(p.from, p.to);
      return sendFile(`xarajatlar-${p.from}_${p.to}.csv`, expensesCSV(list), `📁 Xarajatlar: ${p.label} — ${list.length} ta`);
    }
  }
}

// ---------- Ishga tushirish ----------
async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}&allowed_updates=["message"]`);
      const data = await res.json();
      for (const u of data.result || []) {
        offset = u.update_id + 1;
        const m = u.message;
        if (m?.text?.startsWith('/') && String(m.chat.id) === String(CHAT)) {
          await handle(m.text).catch(e => send('Xatolik: ' + e.message));
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
  poll();
  scheduler();
  console.log('Telegram buyruqlari yoqildi');
}

export const _test = { handle, parsePeriod, parseAmount, report };
