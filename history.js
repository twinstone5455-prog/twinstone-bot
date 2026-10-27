// Eski Direct yozishmalarini Instagram API orqali yuklash va lidlar bazasiga qo'shish.
// Faqat o'qiydi — mijozlarga hech narsa yubormaydi.
import { extractContact, recordLead } from './leads.js';

const { IG_ACCESS_TOKEN: TOKEN, IG_API_VERSION: VER = 'v21.0' } = process.env;
const BASE = `https://graph.instagram.com/${VER}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(path, params = {}) {
  const url = new URL(path.startsWith('http') ? path : `${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', TOKEN);
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  await sleep(120); // limitlarga tushmaslik uchun
  return data;
}

// "2026-10-20T10:15:30+0000" → Toshkent sanasi va vaqti
function tash(ts) {
  const d = new Date(new Date(ts.replace(/\+0000$/, 'Z')).toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

async function conversationMessages(convId) {
  try {
    const d = await get(convId, { fields: 'messages.limit(50){id,message,from,created_time}' });
    return d.messages?.data || [];
  } catch {
    // Zaxira yo'li: avval xabar ID lari, keyin har biri alohida (API faqat oxirgi 20 tasini beradi)
    const d = await get(convId, { fields: 'messages' });
    const out = [];
    for (const m of (d.messages?.data || []).slice(0, 20)) {
      try { out.push(await get(m.id, { fields: 'id,message,from,created_time' })); } catch { /* o'tkazib yuboramiz */ }
    }
    return out;
  }
}

/** fromDate (YYYY-MM-DD) dan bugungacha bo'lgan suhbatlarni yuklaydi */
export async function importHistory(fromDate) {
  const r = { conversations: 0, withContact: 0, added: 0, duplicates: 0, errors: 0 };
  const me = await get('me', { fields: 'user_id,username' });
  const myIds = new Set([me.user_id, me.id].filter(Boolean).map(String));
  const isMine = (from) => from && (myIds.has(String(from.id)) || from.username === me.username);

  let page = await get('me/conversations', { platform: 'instagram', fields: 'id,updated_time,participants', limit: '50' });
  let stop = false;

  while (page && !stop) {
    for (const conv of page.data || []) {
      if (conv.updated_time && tash(conv.updated_time).date < fromDate) { stop = true; break; }
      r.conversations++;
      try {
        const client = (conv.participants?.data || []).find(p => !isMine(p)) || {};
        const msgs = (await conversationMessages(conv.id))
          .filter(m => m.message && !isMine(m.from))
          .sort((a, b) => a.created_time.localeCompare(b.created_time));
        const texts = msgs.map(m => m.message);

        // Sanadan keyin yuborilgan birinchi kontaktli xabar
        const hit = msgs.find(m => tash(m.created_time).date >= fromDate && extractContact(m.message));
        if (!hit) continue;
        r.withContact++;
        const contact = extractContact(hit.message);
        const when = tash(hit.created_time);
        const lead = recordLead({
          ...contact, ...when, source: 'import',
          igId: client.id || hit.from?.id || null,
          instagram: client.username ? '@' + client.username : (hit.from?.username ? '@' + hit.from.username : 'Instagram'),
          messages: texts,
        });
        if (lead) r.added++; else r.duplicates++;
      } catch (e) {
        r.errors++;
        console.error('Import xatosi:', conv.id, e.message);
      }
    }
    page = !stop && page.paging?.next ? await get(page.paging.next) : null;
  }
  console.log('Import:', r);
  return r;
}
