#!/usr/bin/env bash
# Fügt sichere Nginx-Proxy-Locations für /config und /config/... hinzu (ohne Path-Stripping) in ALLEN Serverblöcken für app.wirzapp.ch.
# Nutzt sudo, legt Backup an, testet Konfiguration und lädt Nginx neu.
set -Eeuo pipefail

# Root erzwingen (sudo, mit Fallback auf Passwort-Prompt)
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  exec sudo -n "$0" "$@" 2>/dev/null || exec sudo "$0" "$@"
fi

echo "[1/4] Suche Nginx-Sites mit server_name app.wirzapp.ch ..."
mapfile -t FILES < <(grep -RIlE "server_name[[:space:]]+app\\.wirzapp\\.ch(\s*;)?" /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d 2>/dev/null || true)
if [ ${#FILES[@]} -eq 0 ]; then
  mapfile -t FILES < <(grep -RIlE "server_name[[:space:]]+app\\.wirzapp\\.ch(\s*;)?" /etc/nginx 2>/dev/null | sort -u || true)
fi

if [ ${#FILES[@]} -eq 0 ]; then
  echo "FEHLER: keine passende Konfiguration gefunden." >&2
  exit 1
fi

echo "Gefundene Dateien:"; printf ' - %s\n' "${FILES[@]}"

insert_blocks() {
  local CONF="$1"
  # Bereits vorhanden?
  if grep -qE "location\s*=\s*/config\s*\{" "$CONF"; then
    echo "  [$CONF] /config-Locations bereits vorhanden. Überspringe."
    return 0
  fi
  local TS; TS=$(date +%Y%m%d%H%M%S)
  cp "$CONF" "$CONF.bak.$TS"
  echo "  [$CONF] Backup angelegt: $CONF.bak.$TS"

  awk '
    BEGIN{depth=0;inserver=0;listen443=0;inserted=0}
    /server[[:space:]]*\{/ { depth++; if (depth==1){inserver=1; listen443=0} }
    { if (inserver && $0 ~ /listen[[:space:]]+443(\b|\s|;)/) listen443=1 }
    {
      if (inserver && listen443 && inserted==0 && $0 ~ /^[[:space:]]*location[[:space:]]*\/[[:space:]]*\{[[:space:]]*$/) {
        print "    # hinzugefügt: API-Proxy für /config (kein Path-Stripping)"
        print "    location = /config {"
        print "        proxy_pass http://127.0.0.1:3001;"
        print "        proxy_set_header Host \\$host;"
        print "        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;"
        print "        proxy_set_header X-Forwarded-Proto \\$scheme;"
        print "        client_max_body_size 20m;"
        print "        proxy_read_timeout 600s;"
        print "        proxy_send_timeout 600s;"
        print "    }"
        print ""
        print "    location ^~ /config/ {"
        print "        proxy_pass http://127.0.0.1:3001;"
        print "        proxy_set_header Host \\$host;"
        print "        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;"
        print "        proxy_set_header X-Forwarded-Proto \\$scheme;"
        print "        client_max_body_size 20m;"
        print "        proxy_read_timeout 600s;"
        print "        proxy_send_timeout 600s;"
        print "    }"
        print ""
        inserted=1
      }
      # Fallback: vor Ende des 443er-Serverblocks einfügen
      if (inserver && listen443 && inserted==0 && $0 ~ /^\}/ && depth==1) {
        print "    # hinzugefügt: API-Proxy für /config (kein Path-Stripping)"
        print "    location = /config {"
        print "        proxy_pass http://127.0.0.1:3001;"
        print "        proxy_set_header Host \\$host;"
        print "        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;"
        print "        proxy_set_header X-Forwarded-Proto \\$scheme;"
        print "        client_max_body_size 20m;"
        print "        proxy_read_timeout 600s;"
        print "        proxy_send_timeout 600s;"
        print "    }"
        print ""
        print "    location ^~ /config/ {"
        print "        proxy_pass http://127.0.0.1:3001;"
        print "        proxy_set_header Host \\$host;"
        print "        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;"
        print "        proxy_set_header X-Forwarded-Proto \\$scheme;"
        print "        client_max_body_size 20m;"
        print "        proxy_read_timeout 600s;"
        print "        proxy_send_timeout 600s;"
        print "    }"
        print ""
        inserted=1
      }
      print $0
    }
    /\}/ { if (inserver) { depth--; if (depth==0) { inserver=0 } } }
  ' "$CONF" > "$CONF.new"

  if [ ! -s "$CONF.new" ]; then
    echo "  [$CONF] FEHLER: Bearbeitung fehlgeschlagen." >&2
    return 1
  fi
  mv "$CONF.new" "$CONF"
  echo "  [$CONF] /config-Locations eingefügt."
}

for f in "${FILES[@]}"; do
  insert_blocks "$f" || true
done

echo "[2/4] Nginx-Konfiguration testen ..."
nginx -t

echo "[3/4] Nginx neu laden ..."
systemctl reload nginx || systemctl restart nginx

echo "[4/4] Fertig. Alle passenden Serverblöcke wurden behandelt."
