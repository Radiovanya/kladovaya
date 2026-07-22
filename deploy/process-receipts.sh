#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error --max-time 55 \
  --request POST \
  --header "Authorization: Bearer ${RECEIPT_CRON_SECRET}" \
  http://127.0.0.1:3000/api/internal/process-receipts
