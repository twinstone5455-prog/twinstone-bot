#!/usr/bin/env bash
# Подключение Telegram-группы для заявок из Instagram.
# Запуск: curl -fsSL "https://raw.githubusercontent.com/twinstone5455-prog/twinstone-bot/main/telegram-setup.sh?v=$(date +%s)" | bash
set -e
DIR="/opt/twinstone-instagram"
ENV="$DIR/.env"
ask() { local v; read -r -p "$1" v </dev/tty; echo "$v"; }

[ -f "$ENV" ] || { echo "Сначала установите бота (install.sh)"; exit 1; }

echo "=== Подключение Telegram-группы для заявок ==="
TOKEN=$(ask "Токен Telegram-бота от @BotFather: ")
TOKEN=$(echo "$TOKEN" | tr -d ' ')

ME=$(curl -fsS "https://api.telegram.org/bot$TOKEN/getMe" || true)
echo "$ME" | grep -q '"ok":true' || { echo "Токен не подходит. Проверьте и запустите ещё раз."; exit 1; }
BOTNAME=$(echo "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
echo ">> Бот найден: @$BOTNAME"

# Сбрасываем старые обновления, чтобы найти именно вашу группу
curl -fsS "https://api.telegram.org/bot$TOKEN/getUpdates?offset=-1" >/dev/null || true

echo
echo "Теперь в Telegram:"
echo "  1) Добавьте @$BOTNAME в группу менеджеров (если уже добавлен — удалите и добавьте снова)"
echo "  2) Напишите в группе:  /start@$BOTNAME"
echo
echo "Жду сообщение из группы (до 3 минут)..."

CHAT_ID=""; TITLE=""
for i in $(seq 1 36); do
  UPD=$(curl -fsS "https://api.telegram.org/bot$TOKEN/getUpdates?timeout=5" || true)
  CHAT_ID=$(echo "$UPD" | grep -o '"chat":{"id":-[0-9]*' | tail -1 | grep -o -- '-[0-9]*' || true)
  if [ -n "$CHAT_ID" ]; then
    TITLE=$(echo "$UPD" | grep -o "\"id\":$CHAT_ID,\"title\":\"[^\"]*\"" | tail -1 | sed 's/.*"title":"\(.*\)"/\1/')
    break
  fi
  sleep 1
done

[ -n "$CHAT_ID" ] || { echo "Сообщение из группы не пришло. Проверьте шаги 1–2 и запустите скрипт снова."; exit 1; }
echo ">> Группа найдена: ${TITLE:-без названия} (ID $CHAT_ID)"

sed -i '/^TELEGRAM_BOT_TOKEN=/d;/^TELEGRAM_CHAT_ID=/d' "$ENV"
echo "TELEGRAM_BOT_TOKEN=$TOKEN" >> "$ENV"
echo "TELEGRAM_CHAT_ID=$CHAT_ID" >> "$ENV"

cd "$DIR" && git pull -q && systemctl restart twinstone-instagram

curl -fsS -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -d chat_id="$CHAT_ID" \
  --data-urlencode text="✅ Готово! Сюда будут приходить заявки из Instagram @twinstone.uz" >/dev/null

echo
echo "=============================================="
echo " ГОТОВО! Проверьте группу — там тестовое сообщение."
echo " Заявки из Instagram теперь приходят в «${TITLE:-группу}»."
echo "=============================================="
