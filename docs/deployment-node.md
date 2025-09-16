# Deployment Leitfaden (Node / app.wirzapp.ch)

Dieser Leitfaden beschreibt den minimalen, wiederholbaren Ablauf um den aktuellen Stand (Backend + Designer Build) auf den Produktivserver (z. B. `app.wirzapp.ch`) zu bringen. Fokus: Einfachheit, keine Container, ein einzelner Node/PM2 Prozess.

## Übersicht

- Code-Quelle: Git Repository (dieses Repo).
- Zielpfad Server: `/opt/wallpaper-app`.
- Prozessmanager: PM2 (Service/Startup bereits vorausgesetzt).
- Reverse Proxy: Nginx leitet `https://app.wirzapp.ch/*` → `http://127.0.0.1:3001`.
- Signierte PDF-Links: aktivierbar durch Setzen von `PDF_TOKEN_SECRET` (HMAC SHA-256).

## 1. Voraussetzungen (Server)

Installiert bzw. eingerichtet auf dem Server:

1. Node.js (>= 18) + npm
2. PM2 global: `npm install -g pm2`
3. ImageMagick 7 (`magick -version`) und Ghostscript (`gswin64c -version` bzw. `gs -version`)
4. Ordnerstruktur existiert: `/opt/wallpaper-app` (Eigentümer: deploy User)
5. Nginx vHost zeigt auf `http://127.0.0.1:3001`
6. (Optional) Firewall erlaubt nur 80/443 extern; Port 3001 bleibt intern (loopback)

## 2. Erstes Klonen bzw. Update

```
cd /opt
git clone <REPO_URL> wallpaper-app   # nur initial
cd /opt/wallpaper-app
git fetch --all --prune
git checkout main
git pull --ff-only
```

Optional: Release Tag statt `main` auschecken:
```
git checkout v0.1.0-pdf-proof
```

## 3. Abhängigkeiten installieren

Backend:
```
cd /opt/wallpaper-app/backend
npm ci
```

Frontend (nur für neuen Build):
```
cd /opt/wallpaper-app/frontend
npm ci
npm run build
```

Der Build landet in `frontend/dist/`. Das Backend liefert automatisch `/designer/*`, sofern `dist/index.html` existiert. Falls ein alternativer Deploy-Pfad genutzt wird, kann `dist/` nach `backend/public/designer/` kopiert werden:
```
rsync -a --delete /opt/wallpaper-app/frontend/dist/ /opt/wallpaper-app/backend/public/designer/
```

## 4. Environment konfigurieren

Beispiel `.env` unter `backend/.env.example` kopieren:
```
cd /opt/wallpaper-app/backend
cp .env.example .env
```
Felder setzen (ohne Quotes):

- `PORT=3001`
- `SHOPIFY_SHOP=<shop-subdomain>` (optional wenn OAuth genutzt wird)
- `SHOPIFY_ACCESS_TOKEN=<admin-api-access-token>` (oder OAuth Flow verwenden)
- `PDF_TOKEN_SECRET=<langer zufälliger String>` (aktiviert Signaturpflicht für /config/:id/pdf)

Empfehlung zur Secret-Generierung:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" >> /tmp/secret.txt
```

Systemd/PM2 Setup kann stattdessen Environment über `/etc/environment` oder PM2 Ecosystem Datei setzen (siehe unten).

## 5. PM2 Prozess starten/aktualisieren

Variante A (einfach, direkt):
```
cd /opt/wallpaper-app/backend
pm2 start index.js --name wallpaper-backend
```

Variante B (Ecosystem Datei):
```
cd /opt/wallpaper-app/backend
pm2 start ecosystem.config.js
```

Reload nach Code/Env-Änderung:
```
pm2 reload wallpaper-backend
```

Log-Einsicht:
```
pm2 logs wallpaper-backend --lines 200
```

Autostart hinterlegen (falls nicht aktiv):
```
pm2 save
pm2 startup    # zeigt einen Befehl an – diesen als root ausführen
```

## 6. Signierte PDF-Links testen

1. Sicherstellen `PDF_TOKEN_SECRET` ist gesetzt und Prozess neu gestartet.
2. Beispiel-Konfiguration erzeugen (anpassen falls Endpoint geschützt):
```
curl https://app.wirzapp.ch/config-sample -s | jq .
```
3. ID merken, z. B. `abc123...`. Signierten Link erzeugen:
```
curl "https://app.wirzapp.ch/config/abc123/signed-link" -s | jq .
```
4. Feld `pdf` öffnen – sollte `?sig=...` enthalten und innerhalb der Gültigkeit (expires) einen 200 OK liefern.
5. Entfernt man die `sig` Query bei aktivem Secret, sollte `403 Signatur erforderlich` kommen.

## 7. Smoke Tests (lokal oder Server)

Skript vorhanden: `backend/scripts/smoke-test.js`
```
cd /opt/wallpaper-app/backend
node scripts/smoke-test.js
```
Prüft: `/healthz`, `config-sample`, PDF (> 1 kB) und optional ImageMagick.

## 8. Typische Fehler & Lösungen

| Symptom | Ursache | Lösung |
|---------|---------|-------|
| 403 Signatur erforderlich | `PDF_TOKEN_SECRET` gesetzt, aber kein `?sig=` | Signierten Link mit `/config/:id/signed-link` abrufen |
| 403 Signierter Link ungültig | Ablauf überschritten oder HMAC falsch | Neuen Link generieren |
| 500 PDF konnte nicht erstellt werden | `pdfkit` nicht installiert oder Bildproblem | `npm ci` erneut, Logs prüfen |
| 500 preview_failed | ImageMagick/Ghostscript oder komplexe Datei | `magick -version`, Ghostscript installieren |
| 504 timeout (Preview) | Konvertierung zu langsam | Größere Ressourcen/Server, erneuter Versuch |
| 502 Gateway (Nginx) | Backend nicht erreichbar | PM2 Status, Logs, Port 3001 lauscht? |

## 9. Release Tagging (optional)

Lokal nach verifizierter Produktion:
```
git tag -a v0.1.0-pdf-proof -m "PDF Proof stable snapshot"
git push origin v0.1.0-pdf-proof
```
Server dann explizit Tag auschecken.

## 10. Kurze Checkliste

1. Pull / Checkout Tag
2. `npm ci` Backend (und Frontend bei Build-Änderungen)
3. Frontend `npm run build` (falls UI geändert)
4. PM2 reload
5. Smoke Test
6. Signierte PDF Links prüfen
7. (Optional) Tag setzen & pushen

Fertig. Änderungen sind live.

---
Hinweis: Für weitergehende Shopify OAuth / Theme Integration siehe `docs/operations-guide.de.md`.
