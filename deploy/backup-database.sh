#!/usr/bin/env bash
set -euo pipefail

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
file="/tmp/kladovaya-${timestamp}.sql.gz"
pg_dump "${DATABASE_URL%%\?*}" | gzip -9 > "$file"
/opt/nodejs/bin/node /opt/kladovaya/upload-backup.mjs "$file" "backups/postgresql/$(basename "$file").enc"
rm -f "$file"
