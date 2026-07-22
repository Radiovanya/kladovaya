#!/usr/bin/env bash
set -euo pipefail

remote="${1:-root@217.114.7.70}"
key="${2:-.deploy/kladovaya_beget_ed25519}"
ssh_command="ssh -o StrictHostKeyChecking=accept-new -i ${key}"

rsync -az --delete -e "${ssh_command}" .next/standalone/ "${remote}:/opt/kladovaya/app/"
rsync -az --delete -e "${ssh_command}" .next/static/ "${remote}:/opt/kladovaya/app/.next/static/"
rsync -az --delete -e "${ssh_command}" public/ "${remote}:/opt/kladovaya/app/public/"
${ssh_command} "${remote}" "systemctl restart kladovaya && systemctl is-active kladovaya"
