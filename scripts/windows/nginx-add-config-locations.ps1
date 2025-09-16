param(
  [string]$RemoteHost = 'app.wirzapp.ch',
  [string]$User = 'martin',
  [int]$Port = 22
)

$ErrorActionPreference = 'Stop'

function Test-Command([string]$cmd) {
  try { Get-Command $cmd -ErrorAction Stop | Out-Null }
  catch { throw "Benötigtes Kommando fehlt: $cmd. Bitte installieren oder in PATH aufnehmen." }
}

Test-Command ssh

Write-Host "Verbinde zu $User@$RemoteHost und füge Nginx-Location-Blöcke für /config ein ..." -ForegroundColor Cyan

# Wir suchen die Konfig mit server_name app.wirzapp.ch, erstellen ein Backup,
# fügen NUR falls nicht vorhanden die beiden Location-Blöcke direkt nach der server_name-Zeile ein,
# testen Config und laden Nginx neu. Läuft mit sudo (interaktiv, Passworteingabe im Prompt).

$remote = @'
set -e
CONF="$(sudo grep -RIl 'server_name[[:space:]]\+app.wirzapp.ch' /etc/nginx 2>/dev/null | head -n1)"
if [ -z "$CONF" ]; then echo "Konfiguration für app.wirzapp.ch nicht gefunden"; exit 1; fi

sudo cp "$CONF" "$CONF.bak.$(date +%Y%m%d%H%M%S)"

if sudo grep -qE "location[[:space:]]*=\s*/config\s*\{" "$CONF"; then
  echo "location = /config bereits vorhanden. Überspringe Einfügen."
else
  sudo sed -i "/server_name[[:space:]]\+app.wirzapp.ch;/a \
    # Sicherstellen: Backend sieht exakt /config und /config/...\n\
    location = /config {\n\
        proxy_pass http://127.0.0.1:3001;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Forwarded-Proto $scheme;\n\
        client_max_body_size 20m;\n\
        proxy_read_timeout 600s;\n\
        proxy_send_timeout 600s;\n\
    }\n\
\n\
    location ^~ /config/ {\n\
        proxy_pass http://127.0.0.1:3001;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Forwarded-Proto $scheme;\n\
        client_max_body_size 20m;\n\
        proxy_read_timeout 600s;\n\
        proxy_send_timeout 600s;\n\
    }" "$CONF"
  echo "Blöcke eingefügt."
fi

sudo nginx -t
sudo systemctl reload nginx
echo OK
'@

# -t sorgt für ein interaktives PTY, damit sudo ggf. Passwort abfragt
ssh -t -p $Port "$User@$RemoteHost" "bash -lc $([char]34)$remote$([char]34)"

Write-Host "Fertig." -ForegroundColor Green
