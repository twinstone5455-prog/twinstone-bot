#!/usr/bin/env bash
# Установка Instagram-бота Twinstone на сервер Ubuntu/Debian.
# Работает и на чистом сервере, и рядом с уже запущенным Caddy (не ломает существующие сайты).
# Запуск:  curl -fsSL https://raw.githubusercontent.com/twinstone5455-prog/twinstone-bot/main/install.sh | bash
set -e

REPO="https://github.com/twinstone5455-prog/twinstone-bot.git"
DIR="/opt/twinstone-instagram"
SERVICE="twinstone-instagram"
ask() { local v; read -r -p "$1" v </dev/tty; echo "$v"; }
port_busy() { ss -ltn | grep -qE "[:.]$1 "; }

echo "=== Установка Instagram-бота Twinstone ==="
[ "$(id -u)" -eq 0 ] || { echo "Запустите от root"; exit 1; }

apt-get update -y >/dev/null
apt-get install -y curl git ca-certificates gnupg >/dev/null

# ---------- Node.js ----------
NODE=""
for n in "$(command -v node || true)" /opt/twinstone/node/bin/node; do
  if [ -x "$n" ] && [ "$("$n" -v | cut -d. -f1 | tr -d v)" -ge 18 ]; then NODE="$n"; break; fi
done
if [ -z "$NODE" ]; then
  echo ">> Устанавливаю Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
  NODE="$(command -v node)"
fi
NPM="$(dirname "$NODE")/npm"; [ -x "$NPM" ] || NPM="$(command -v npm)"
echo ">> Node: $NODE ($("$NODE" -v))"

# ---------- Код ----------
echo ">> Скачиваю код бота в $DIR ..."
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q; else git clone -q "$REPO" "$DIR"; fi
cd "$DIR"
PATH="$(dirname "$NODE"):$PATH" "$NPM" install --omit=dev --silent

# ---------- Свободный порт ----------
APP_PORT=3010
while port_busy $APP_PORT; do APP_PORT=$((APP_PORT+1)); done
echo ">> Порт бота: $APP_PORT"

# ---------- Ключи ----------
if [ ! -f .env ]; then
  echo
  echo "=== Введите ключи (вставка: правая кнопка мыши или Ctrl+V) ==="
  IG_ACCESS_TOKEN=$(ask "IG_ACCESS_TOKEN (токен Instagram): ")
  IG_APP_SECRET=$(ask "IG_APP_SECRET (секрет приложения Instagram): ")
  ANTHROPIC_API_KEY=$(ask "ANTHROPIC_API_KEY (ключ Claude, Enter = бесплатный режим): ")
  TELEGRAM_BOT_TOKEN=$(ask "TELEGRAM_BOT_TOKEN для заявок (Enter = пропустить): ")
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
PORT=$APP_PORT
HUMAN_PAUSE_HOURS=12
EOF
  chmod 600 .env
else
  sed -i "s/^PORT=.*/PORT=$APP_PORT/" .env
fi

# ---------- Служба systemd ----------
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=TwinStone Instagram bot
After=network.target

[Service]
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null 2>&1
systemctl restart $SERVICE
sleep 2
systemctl is-active --quiet $SERVICE || { echo "Бот не запустился:"; journalctl -u $SERVICE -n 30 --no-pager; exit 1; }

# ---------- HTTPS через Caddy ----------
IP=$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
DEFAULT_DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"
DOMAIN=$(ask "Домен для бота (Enter = $DEFAULT_DOMAIN): ")
DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}
BLOCK="
# --- Instagram-бот Twinstone ---
$DOMAIN {
  reverse_proxy 127.0.0.1:$APP_PORT
}"

CADDY_PID=$(pgrep -xo caddy || true)
if [ -n "$CADDY_PID" ]; then
  # Caddy уже работает — дописываем блок в ЕГО конфиг, ничего не удаляя
  ARGS=$(ps -o args= -p "$CADDY_PID")
  CADDY_BIN=$(echo "$ARGS" | awk '{print $1}')
  CONF=$(echo "$ARGS" | sed -n 's/.*--config[ =]\([^ ]*\).*/\1/p')
  CONF=${CONF:-/etc/caddy/Caddyfile}
  UNIT=$(ps -o unit= -p "$CADDY_PID" | tr -d ' ')
  echo ">> Найден работающий Caddy: $CONF (служба: ${UNIT:-нет})"
  if grep -qF "$DOMAIN" "$CONF"; then
    echo ">> Домен уже есть в конфиге — пропускаю"
  else
    cp "$CONF" "$CONF.backup-$(date +%Y%m%d-%H%M%S)"
    printf '%s\n' "$BLOCK" >> "$CONF"
    if ! "$CADDY_BIN" validate --config "$CONF" --adapter caddyfile >/dev/null 2>&1; then
      echo "ОШИБКА в конфиге — возвращаю как было"
      cp "$(ls -t "$CONF".backup-* | head -1)" "$CONF"; exit 1
    fi
  fi
  "$CADDY_BIN" reload --config "$CONF" --adapter caddyfile 2>/dev/null \
    || { [ -n "$UNIT" ] && systemctl restart "$UNIT"; }
else
  if ! command -v caddy >/dev/null; then
    echo ">> Устанавливаю Caddy..."
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y >/dev/null && apt-get install -y caddy >/dev/null
  fi
  printf '%s\n' "$BLOCK" >> /etc/caddy/Caddyfile
  systemctl enable caddy >/dev/null 2>&1; systemctl restart caddy
fi

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

VERIFY=$(grep '^IG_VERIFY_TOKEN=' .env | cut -d= -f2)
echo
echo "=============================================="
echo " ГОТОВО! Вставьте в Meta -> 3. Настройте Webhooks:"
echo
echo "  URL обратного вызова:  https://$DOMAIN/webhook"
echo "  Подтверждение маркера: $VERIFY"
echo
echo " Проверка: откройте https://$DOMAIN в браузере"
echo " Логи:     journalctl -u $SERVICE -f"
echo "=============================================="
