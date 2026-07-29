#!/usr/bin/env bash
set -euo pipefail

app_dir="/opt/kladovaya/app"
env_file="/opt/kladovaya/.env"
secret_file="/tmp/oplatakladov-mail-secret"
mailbox="payments@oplatakladov.ru"

test -s "$secret_file"
mail_password="$(tr -d '\r\n' < "$secret_file")"

cd "$app_dir"
MAILBOX="$mailbox" MAIL_PASSWORD="$mail_password" python3 -c '
import os
import smtplib
with smtplib.SMTP_SSL("smtp.beget.com", 465, timeout=20) as client:
    client.login(os.environ["MAILBOX"], os.environ["MAIL_PASSWORD"])
'

MAILBOX="$mailbox" MAIL_PASSWORD="$mail_password" python3 -c '
import imaplib
import os
client = imaplib.IMAP4_SSL("imap.beget.com", 993, timeout=20)
client.login(os.environ["MAILBOX"], os.environ["MAIL_PASSWORD"])
client.logout()
'

cp "$env_file" "${env_file}.before-oplatakladov-$(date +%Y%m%d%H%M%S)"

set_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      print key "=\"" value "\""
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print key "=\"" value "\""
    }
  ' "$env_file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
}

set_env SMTP_USER "$mailbox"
set_env SMTP_PASSWORD "$mail_password"
set_env SMTP_FROM "Оплата кладовых <$mailbox>"
set_env IMAP_USER "$mailbox"
set_env IMAP_PASSWORD "$mail_password"
set_env RECEIPT_EMAIL "$mailbox"

install -d -m 755 /var/www/oplatakladov
install -m 644 /tmp/oplatakladov-index.html /var/www/oplatakladov/index.html
install -m 644 /tmp/nginx-oplatakladov.conf /etc/nginx/sites-available/oplatakladov
ln -sfn /etc/nginx/sites-available/oplatakladov /etc/nginx/sites-enabled/oplatakladov
nginx -t
systemctl reload nginx

certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  --redirect -d oplatakladov.ru

database_url="$(sed -n 's/^DATABASE_URL="\(.*\)"$/\1/p' "$env_file")"
DATABASE_URL="$database_url" RECEIPT_EMAIL="$mailbox" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!state) throw new Error("App state not found");
  const data = structuredClone(state.payload);
  data.paymentSettings = { ...(data.paymentSettings || {}), receiptEmail: process.env.RECEIPT_EMAIL };
  await prisma.appState.update({
    where: { id: 1 },
    data: { payload: data, version: { increment: 1 } }
  });
})().finally(() => prisma.$disconnect());
'

systemctl restart kladovaya
systemctl restart kladovaya-receipts.timer
for _ in $(seq 1 30); do
  if curl -sS -o /dev/null http://127.0.0.1:3000/api/auth/session; then
    break
  fi
  sleep 1
done
systemctl start kladovaya-receipts.service
rm -f "$secret_file"

systemctl is-active kladovaya
systemctl is-active kladovaya-receipts.timer
