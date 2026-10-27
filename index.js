import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { ruleReply } from './rules.js';

const {
  IG_ACCESS_TOKEN,
  IG_APP_SECRET,
  IG_VERIFY_TOKEN,
  IG_API_VERSION = 'v21.0',
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL = 'claude-sonnet-5-5',
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  PORT = 3000,
  HUMAN_PAUSE_HOURS = 12,
} = process.env;

// Без ключа Claude бот работает бесплатно — по ключевым словам (rules.js)
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
console.log(anthropic ? 'Режим: ИИ (Claude)' : 'Режим: бесплатный (ключевые слова)');
const KNOWLEDGE = fs.readFileSync(new URL('./knowledge.md', import.meta.url), 'utf8');

const SYSTEM_PROMPT = `Ты — вежливый онлайн-консультант компании Twinstone в Instagram Direct.
Отвечай на языке клиента (узбекский — латиница или кириллица, как пишет клиент; русский; английский).
Пиши коротко, как в мессенджере: 1–4 предложения, без markdown, можно 1 эмодзи.
Отвечай ТОЛЬКО по базе знаний ниже. Если информации нет (точная цена, наличие, сроки под объём) —
не выдумывай, скажи, что уточнит менеджер, и попроси номер телефона.
Твоя цель — помочь и получить контакт: имя, телефон, что нужно (товар, объём в м², город/объект).
Предлагай бесплатный дизайн-проект раскладки и выезд менеджера на объект.

Когда клиент оставил номер телефона ИЛИ просит живого менеджера, в САМОМ КОНЦЕ ответа добавь отдельной строкой:
[LEAD] имя=...; телефон=...; запрос=...
(неизвестные поля пиши "-"). Клиент эту строку не увидит.

=== БАЗА ЗНАНИЙ ===
${KNOWLEDGE}`;

// ---------- Память в оперативке (для продакшна можно заменить на Redis/БД) ----------
const histories = new Map();   // userId -> [{role, content}]
const pausedUntil = new Map(); // userId -> timestamp
const botMessageIds = new Set();
const processedMids = new Set();
const MAX_HISTORY = 20;
const pauseMs = Number(HUMAN_PAUSE_HOURS) * 3600 * 1000;

const HANDOFF_WORDS = /(менеджер|оператор|живой|человек|menejer|operator|odam bilan|manager|human)/i;

// ---------- Сервер ----------
const app = express();
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.get('/', (_req, res) => res.send('Twinstone Instagram bot is running'));

// Политика конфиденциальности и удаление данных — нужны Meta для публикации приложения
const PAGE = (title, body) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6;color:#222}</style>
</head><body>${body}</body></html>`;

app.get('/privacy', (_req, res) => res.send(PAGE('Политика конфиденциальности TwinStone', `
<h1>Политика конфиденциальности</h1>
<p>Эта политика описывает, как компания TwinStone (Ташкент, Узбекистан) обрабатывает данные
в автоматическом помощнике Instagram-аккаунта @twinstone.uz.</p>
<h2>Какие данные мы получаем</h2>
<p>Текст сообщений, которые вы отправляете нам в Instagram Direct, ваш Instagram ID и имя пользователя,
а также контактные данные (имя, номер телефона), если вы сами их сообщаете.</p>
<h2>Зачем</h2>
<p>Только чтобы ответить на ваш вопрос о нашей продукции и передать вашу заявку менеджеру отдела продаж.
Мы не продаём и не передаём ваши данные третьим лицам и не используем их для рекламы.</p>
<h2>Хранение</h2>
<p>История переписки хранится в оперативной памяти сервера и удаляется при его перезапуске.
Заявки с номером телефона передаются менеджерам TwinStone для обратной связи.</p>
<h2>Удаление данных</h2>
<p>Чтобы удалить ваши данные, напишите нам в Instagram Direct слово «удалить» или свяжитесь с нами
по адресу twinstone5455@gmail.com. Подробнее: <a href="/data-deletion">удаление данных</a>.</p>
<h2>Контакты</h2>
<p>TwinStone, г. Ташкент, Мирзо-Улугбекский район, ул. Буюк Ипак Йули, 434. Email: twinstone5455@gmail.com</p>
`)));

app.get('/data-deletion', (_req, res) => res.send(PAGE('Удаление данных TwinStone', `
<h1>Удаление данных</h1>
<p>Чтобы удалить данные, которые помощник TwinStone получил из Instagram, напишите в Direct @twinstone.uz
слово «удалить» или отправьте письмо на twinstone5455@gmail.com с вашим именем пользователя Instagram.
Мы удалим данные в течение 7 дней и подтвердим это ответом.</p>
`)));

app.get('/terms', (_req, res) => res.send(PAGE('Условия использования TwinStone', `
<h1>Условия использования</h1>
<p>Автоматический помощник @twinstone.uz отвечает на вопросы о продукции TwinStone.
Цены в ответах ориентировочные; окончательную цену и условия сообщает менеджер.</p>
`)));

// Проверка вебхука Meta
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === IG_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Входящие события
app.post('/webhook', (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // Meta ждёт быстрый ответ, обрабатываем асинхронно

  for (const entry of req.body.entry || []) {
    for (const event of entry.messaging || []) {
      handleEvent(event).catch(err => console.error('handleEvent error:', err));
    }
  }
});

function validSignature(req) {
  if (!IG_APP_SECRET) return true;
  const sig = req.get('x-hub-signature-256');
  if (!sig || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', IG_APP_SECRET).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

// ---------- Логика ----------
async function handleEvent(event) {
  const msg = event.message;
  if (!msg) return;

  if (msg.mid) {
    if (processedMids.has(msg.mid)) return; // Meta иногда шлёт повторно
    remember(processedMids, msg.mid);
  }

  // Эхо — сообщение, отправленное с нашего аккаунта
  if (msg.is_echo) {
    const clientId = event.recipient.id;
    await sleep(3000); // ждём, пока бот запишет id своего сообщения
    if (!botMessageIds.has(msg.mid)) {
      // Ответил живой менеджер из приложения Instagram — бот замолкает в этом чате
      pausedUntil.set(clientId, Date.now() + pauseMs);
      console.log(`Менеджер ответил ${clientId}, бот на паузе ${HUMAN_PAUSE_HOURS} ч`);
    }
    return;
  }

  const userId = event.sender.id;
  if ((pausedUntil.get(userId) || 0) > Date.now()) return;

  // Фото, видео, голосовые, репосты сторис
  if (!msg.text) {
    if (msg.attachments?.length) {
      await sendText(userId,
        'Спасибо! Менеджер посмотрит вложение и ответит. Напишите, пожалуйста, ваш вопрос текстом и номер телефона 🙏\n' +
        'Rahmat! Menejer ko‘rib chiqadi. Savolingizni va telefon raqamingizni yozib qoldiring 🙏');
      await notifyTelegram(`📎 Вложение в Директ от клиента ${userId}`);
    }
    return;
  }

  const text = msg.text.trim();
  const history = histories.get(userId) || [];
  history.push({ role: 'user', content: text });

  let reply;
  let lead = null;
  if (anthropic) {
    reply = await askAI(history);
  } else {
    const r = ruleReply(text, history.length === 1);
    reply = r.reply;
    lead = r.lead;
  }
  const leadMatch = reply.match(/\[LEAD\](.*)$/m);
  if (leadMatch) {
    lead = leadMatch[1].trim();
    reply = reply.replace(/\n?\[LEAD\].*$/m, '').trim();
  }

  history.push({ role: 'assistant', content: reply });
  histories.set(userId, history.slice(-MAX_HISTORY));

  await sendText(userId, reply);

  if (lead || HANDOFF_WORDS.test(text)) {
    const username = await getUsername(userId);
    await notifyTelegram(
      `🔥 Заявка из Instagram\nКлиент: ${username ? '@' + username : userId}\n` +
      (lead ? `Данные: ${lead}\n` : '') +
      `Последнее сообщение: ${text}`
    );
    if (HANDOFF_WORDS.test(text)) pausedUntil.set(userId, Date.now() + pauseMs);
  }
}

async function askAI(history) {
  try {
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: history,
    });
    return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } catch (err) {
    console.error('AI error:', err.message);
    return 'Здравствуйте! Менеджер скоро ответит вам. Оставьте, пожалуйста, номер телефона.\n' +
           'Assalomu alaykum! Menejer tez orada javob beradi. Telefon raqamingizni qoldiring.';
  }
}

// ---------- Instagram API ----------
async function sendText(userId, text) {
  // Лимит Instagram — 1000 символов на сообщение
  for (const part of chunk(text, 990)) {
    const res = await fetch(`https://graph.instagram.com/${IG_API_VERSION}/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${IG_ACCESS_TOKEN}` },
      body: JSON.stringify({ recipient: { id: userId }, message: { text: part } }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('Send error:', JSON.stringify(data)); return; }
    if (data.message_id) remember(botMessageIds, data.message_id);
  }
}

async function getUsername(userId) {
  try {
    const res = await fetch(
      `https://graph.instagram.com/${IG_API_VERSION}/${userId}?fields=username,name&access_token=${IG_ACCESS_TOKEN}`);
    const data = await res.json();
    return data.username || data.name || null;
  } catch { return null; }
}

// ---------- Telegram ----------
async function notifyTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
  } catch (err) { console.error('Telegram error:', err.message); }
}

// ---------- Утилиты ----------
function chunk(str, size) {
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts;
}
function remember(set, id) {
  set.add(id);
  if (set.size > 5000) set.delete(set.values().next().value);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));
