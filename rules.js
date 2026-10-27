// Бесплатный режим: ответы по ключевым словам (используется, когда нет ключа Claude).
// Тексты можно менять прямо здесь. Латиница -> ответ на узбекском, кириллица -> на русском.

const PHONE = process.env.COMPANY_PHONE || '';
const phoneLine = (lang) => PHONE
  ? (lang === 'uz' ? `\nTelefon: ${PHONE}` : `\nТелефон: ${PHONE}`)
  : '';

const T = {
  menu: {
    ru: 'Здравствуйте! Это TwinStone 👋 Мы производим брусчатку, тротуарную плитку, продаём гранит и каменный ковёр.\n' +
        'Напишите, что вас интересует: цена, брусчатка, гранит, адрес, доставка — или оставьте номер телефона, и менеджер перезвонит.',
    uz: 'Assalomu alaykum! Bu TwinStone 👋 Biz bruschatka, trotuar plitka ishlab chiqaramiz, granit va tosh gilam sotamiz.\n' +
        'Nima qiziqtiradi: narx, bruschatka, granit, manzil, yetkazib berish — yoki telefon raqamingizni qoldiring, menejer qo‘ng‘iroq qiladi.',
  },
  price: {
    ru: 'Брусчатка и плитка — ориентировочно от 73 900 до 151 900 сум за м², чаще всего 73 900–99 900. ' +
        'Гранит — от 145 000 сум. Точная цена зависит от вида, цвета и объёма. Напишите, что нужно и сколько м², и оставьте номер — менеджер посчитает.',
    uz: 'Bruschatka va plitka — taxminan 1 m² uchun 73 900 dan 151 900 so‘mgacha, ko‘pincha 73 900–99 900. ' +
        'Granit — 145 000 so‘mdan. Aniq narx turi, rangi va hajmiga bog‘liq. Nima kerak va necha m² ekanini yozing, raqamingizni qoldiring — menejer hisoblab beradi.',
  },
  paving: {
    ru: 'Брусчатка 200×100 (4 и 6 см), квадрат 200×200 и 100×100, «Старый город», прямоугольник 200×400, ромб, лепесток, таркет. ' +
        'Цвета: чёрно-красный, белый, серый, промывка, мульти- и колор-микс. Делаем бесплатный дизайн-проект раскладки. Сколько м² вам нужно?',
    uz: 'Bruschatka 200×100 (4 va 6 sm), kvadrat 200×200 va 100×100, «Eski shahar», to‘rtburchak 200×400, romb, lepestok, tarket. ' +
        'Ranglar: qora-qizil, oq, kulrang, promivka, multi va kolor-miks. Yotqizish dizaynini bepul qilib beramiz. Sizga necha m² kerak?',
  },
  granite: {
    ru: 'Натуральный гранит: Kok saroy, Qorabog‘, Avrora — от 150 000 сум; Suvliq — от 160 000; Qoshrabod — от 330 000; ' +
        'Angola Black — от 404 529; колотый — от 145 000. Также травертин. Для точной цены напишите размеры и объём.',
    uz: 'Tabiiy granit: Ko‘k saroy, Qorabog‘, Avrora — 150 000 so‘mdan; Suvliq — 160 000; Qo‘shrabod — 330 000; ' +
        'Angola Black — 404 529; ko‘chirma — 145 000 so‘mdan. Travertin ham bor. Aniq narx uchun o‘lcham va hajmini yozing.',
  },
  carpet: {
    ru: 'Каменный ковёр делаем под ваш объект. Цену и варианты подскажет менеджер — оставьте номер телефона, пожалуйста.',
    uz: 'Tosh gilamni obyektingizga moslab qilamiz. Narx va variantlarni menejer aytadi — telefon raqamingizni qoldiring.',
  },
  address: {
    ru: 'Наш адрес: Ташкент, Мирзо-Улугбекский район, ул. Буюк Ипак Йули, 434 (с обратной стороны завода), ориентир — за заводом ТТЗ.',
    uz: 'Manzilimiz: Toshkent, Mirzo Ulug‘bek tumani, Buyuk Ipak Yo‘li, 434 (zavodning orqa tomoni), mo‘ljal — TTZ zavodi orqasi.',
  },
  delivery: {
    ru: 'Да, доставляем — обычная и экспресс-доставка. Стоимость зависит от адреса и объёма. Напишите город/район и сколько м² — менеджер посчитает.',
    uz: 'Ha, yetkazib beramiz — oddiy va tezkor. Narxi manzil va hajmga bog‘liq. Shahar/tuman va necha m² ekanini yozing — menejer hisoblaydi.',
  },
  payment: {
    ru: 'Оплата: наличные, перечисление, терминалы UzCard и HUMO.',
    uz: 'To‘lov: naqd, perechisleniye, UzCard va HUMO terminallari.',
  },
  thanks: {
    ru: 'Спасибо! Номер получили, менеджер свяжется с вами в ближайшее время 🙏',
    uz: 'Rahmat! Raqamingizni oldik, menejer tez orada bog‘lanadi 🙏',
  },
  fallback: {
    ru: 'Спасибо за сообщение! Менеджер скоро ответит. Чтобы было быстрее, оставьте номер телефона 🙏',
    uz: 'Xabaringiz uchun rahmat! Menejer tez orada javob beradi. Tezroq bo‘lishi uchun telefon raqamingizni qoldiring 🙏',
  },
};

const RULES = [
  ['price',    /(цен|сколько|стоит|стоимост|прайс|почём|narx|нарх|qancha|канча|price|cost)/i],
  ['granite',  /(гранит|granit|травертин|travertin)/i],
  ['carpet',   /(ковёр|ковер|ковр|gilam|гилам)/i],
  ['paving',   /(брусчат|плитк|bruschat|brusсhat|plitka|trotuar|тротуар|каталог|katalog|цвет|rang)/i],
  ['address',  /(адрес|где вы|где наход|локац|manzil|манзил|qayer|қаер|kayer|location|lokatsiya)/i],
  ['delivery', /(доставк|привез|yetkaz|етказ|dostavka|olib kel)/i],
  ['payment',  /(оплат|рассроч|карт|tolov|to‘lov|to'lov|тўлов|nasiya|karta)/i],
];

const GREETING = /^(привет|здравств|добр|салам|салом|ассалом|salom|assalom|hello|hi|ку)/i;

export function ruleReply(text, isFirstMessage) {
  const lang = /[а-яёўқғҳ]/i.test(text) ? 'ru' : 'uz';
  const digits = text.replace(/\D/g, '');

  if (digits.length >= 9) {
    return {
      reply: T.thanks[lang],
      lead: `телефон=${digits}; сообщение=${text}`,
    };
  }

  const parts = RULES.filter(([, re]) => re.test(text)).map(([key]) => T[key][lang]);
  if (parts.length) return { reply: parts.slice(0, 2).join('\n\n') + phoneLine(lang), lead: null };

  if (isFirstMessage || GREETING.test(text.trim())) return { reply: T.menu[lang], lead: null };

  return { reply: T.fallback[lang] + phoneLine(lang), lead: `сообщение без ответа: ${text}` };
}
