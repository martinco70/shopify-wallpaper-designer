#!/usr/bin/env bash
set -euo pipefail

conf="/etc/nginx/sites-available/app.wirzapp.ch"
include_line="include /etc/nginx/snippets/wpd-code-pdf.conf;"

if ! grep -qF "$include_line" "$conf"; then
  cp "$conf" "${conf}.bak-$(date +%Y%m%d%H%M%S)"
  awk 'c==0 && /listen[ \t]+443/ {print; print "    include /etc/nginx/snippets/wpd-code-pdf.conf;"; c=1; next}1' "$conf" > "${conf}.tmp"
  mv "${conf}.tmp" "$conf"
fi

nginx -t
systemctl reload nginx
echo "INCLUDE_OK"
