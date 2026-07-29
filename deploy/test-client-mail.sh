#!/usr/bin/env bash
set -euo pipefail

systemctl stop kladovaya-receipts.timer
trap 'systemctl start kladovaya-receipts.timer' EXIT

python3 - <<'PY'
import email.message
import imaplib
import smtplib
import time
import uuid

values = {}
with open("/opt/kladovaya/.env", encoding="utf-8") as source:
    for line in source:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')

mailbox = values["SMTP_USER"]
password = values["SMTP_PASSWORD"]
marker = f"oplatakladov-self-test-{uuid.uuid4()}"
message = email.message.EmailMessage()
message["From"] = mailbox
message["To"] = mailbox
message["Subject"] = marker
message.set_content("Automated transport verification.")

with smtplib.SMTP_SSL(values["SMTP_HOST"], int(values["SMTP_PORT"]), timeout=20) as smtp:
    smtp.login(mailbox, password)
    smtp.send_message(message)

found = []
client = imaplib.IMAP4_SSL(values["IMAP_HOST"], int(values["IMAP_PORT"]), timeout=20)
client.login(values["IMAP_USER"], values["IMAP_PASSWORD"])
client.select("INBOX")
for _ in range(12):
    _, data = client.uid("search", None, "SUBJECT", f'"{marker}"')
    found = data[0].split()
    if found:
        break
    time.sleep(2)
if not found:
    client.logout()
    raise RuntimeError("Test message was not received")
for message_id in found:
    client.uid("store", message_id, "+FLAGS", "\\Deleted")
# Remove any test message left by an interrupted previous verification.
_, old_data = client.uid("search", None, "SUBJECT", '"oplatakladov-self-test-"')
for message_id in old_data[0].split():
    client.uid("store", message_id, "+FLAGS", "\\Deleted")
client.expunge()
client.logout()
print("mail_roundtrip=ok")
PY
