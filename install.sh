#!/usr/bin/env bash
# Установка Instagram-бота Twinstone на сервер Ubuntu/Debian (Hetzner и др.)
# Запуск:  curl -fsSL https://raw.githubusercontent.com/twinstone5455-prog/twinstone-bot/main/install.sh | sudo bash
set -e

REPO="https://github.com/twinstone5455-prog/twinstone-bot.git"
DIR="/opt/twinstone-bot"
ask() { local v; read -r -p "$1" v </dev/tty; echo "$v"; }

echo "=== Установка Instagram-бота Twinstone ==="

if [ "$(id -u)" -ne 0 ]; then echo "Запустите от root (или через sudo)"; exit 1; fi

# Порт 80/443 нужен для https. Если там уже работает nginx/apache — останавливаемся.
if ss -ltn | grep -qE ':(80|443) ' && ! systemctl is-active --quiet caddy; then
  echo "ВНИМАНИЕ: порт 80 или 443 уже занят другой программой (nginx/apache?)."
  echo "Напишите об этом в чат — настроим через существующий веб-сервер."
  exit 1
fi

echo ">> Устанавливаю системные пакеты..."
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  echo ">> Устанавливаю Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo ">> Устанавливаю Caddy (https-сертификат автоматически)..."
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

npm install -g pm2 >/dev/null

echo ">> Скачиваю код бота..."
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull; else git clone "$REPO" "$DIR"; fi
cd "$DIR"
npm install --omit=dev

if [ ! -f .env ]; then
  echo
  echo "=== Введите ключи (вставка: правая кнопка мыши) ==="
  IG_ACCESS_TOKEN=$(ask "IG_ACCESS_TOKEN (токен Instagram): ")
  IG_APP_SECRET=$(ask "IG_APP_SECRET (секрет приложения Instagram): ")
  ANTHROPIC_API_KEY=$(ask "ANTHROPIC_API_KEY (ключ Claude, Enter = бесплатный режим): ")
  TELEGRAM_BOT_TOKEN=$(ask "TELEGRAM_BOT_TOKEN (Enter = пропустить): ")
  TELEGRAM_CHAT_ID=$(ask "TELEGRAM_CHAT_ID (Enter = пропустить): ")
  COMPANY_PHONE=$(ask "Телефон компании для клиентов (Enter = пропустить): ")
  VERIFY="twinstone_$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > .env <<EOF
IG_ACCESS_TOKEN=$IG_ACCESS_TOKEN
IG_APP_SECRET=$IG_APP_SECRET
IG_VERIFY_TOKEN=$VERIFY
IG_API_VERSION=v21.0
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
CLAUDE_MODEL=claude-sonnet-5-5
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID
COMPANY_PHONE=$COMPANY_PHONE
PORT=3000
HUMAN_PAUSE_HOURS=12
EOF
  chmod 600 .env
fi

# Домен: свой (если есть) или бесплатный адрес вида 1-2-3-4.sslip.io
IP=$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
DEFAULT_DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"
DOMAIN=$(ask "Домен для бота (Enter = $DEFAULT_DOMAIN): ")
DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF

if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 80/tcp; ufw allow 443/tcp
fi

echo ">> Запускаю бота..."
pm2 delete twinstone-bot >/dev/null 2>&1 || true
pm2 start index.js --name twinstone-bot
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null
systemctl enable caddy >/dev/null
systemctl restart caddy

VERIFY=$(grep '^IG_VERIFY_TOKEN=' .env | cut -d= -f2)
echo
echo "=============================================="
echo " ГОТОВО! Вставьте в Meta -> Настройте Webhooks:"
echo
echo "  URL обратного вызова:  https://$DOMAIN/webhook"
echo "  Подтверждение маркера: $VERIFY"
echo
echo " Проверка: откройте https://$DOMAIN в браузере"
echo " Логи бота:  pm2 logs twinstone-bot"
echo "=============================================="
