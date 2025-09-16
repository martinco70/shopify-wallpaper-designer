# Systemübersicht und Deployment (app.wirzapp.ch + GitHub + Shopify)

Dieses Dokument beschreibt das Zusammenspiel von lokalem Frontend/Backend, dem Server app.wirzapp.ch (Nginx + PM2) und der GitHub-Anbindung, über die das Shopify-Theme den Designer-Launcher lädt. Es erklärt Abhängigkeiten, Synchronisation und was bei lokalen Änderungen bis zur Ausspielung zu tun ist.

## Komponentenüberblick

- Frontend (Designer UI)
  - React/Webpack-Bundle, Entwicklungsserver lokal auf http://localhost:8080.
  - Produktions-Build landet in `frontend/dist/` und wird als `/designer/*` ausgeliefert.
  - Live-Bundle auf Prod ist `https://app.wirzapp.ch/designer/main.js` (Eintrittspunkt).

- Backend (API + Static Host)
  - Node/Express, hört auf `127.0.0.1:3001` (loopback), Prozessname unter PM2: `wallpaper-backend`.
  - Endpunkte u. a.: `GET /materials`, `GET /price/:sku`, `POST /upload`, `GET /healthz`.
  - Statisch: `/designer` (Produktionsbundle), `/uploads/*` (Datei-Previews), `/public/*`.
  - Server-Verzeichnis: `/opt/wallpaper-app` (z. B. `/opt/wallpaper-app/public/designer`).

- Reverse Proxy (Nginx)
  - vHost: `app.wirzapp.ch`.
  - Proxy-Pass auf Backend: `http://127.0.0.1:3001` (z. B. für `/`, `/materials`, `/upload`).
  - Liefert die Designer-Assets unter `/designer/*` (via Backend-Static hinter dem Proxy).

- Shopify-Integration (Launcher)
  - Das Shopify-Theme lädt einen Launcher (`backend/public/wpd-launcher.js`), der ein Overlay/iframe zu `https://app.wirzapp.ch/designer/index.html` öffnet und Parameter übergibt (z. B. Bild, Maße, Cache-Busting).
  - Das Theme selbst wird aus einem GitHub-Repository mit Shopify synchronisiert (entweder per Shopify GitHub-App oder via CI/Shopify CLI). Der Launcher-Verweis im Theme muss auf die produktive URL zeigen.

## Datenfluss (vereinfacht)

1. Kunde öffnet Produktseite im Shopify-Store → Theme lädt den Launcher.
2. Launcher öffnet `app.wirzapp.ch/designer/index.html` (optional mit Query-Parametern).
3. Die Designer-UI lädt Material-/Preislisten (`/materials`, `/price/:sku`) und verarbeitet Uploads (`/upload`).
4. Nginx leitet API-Calls an das Backend (127.0.0.1:3001) weiter; Static wird von `/designer` ausgeliefert.

## Abhängigkeiten und Synchronisation

- Canonical Code: Dieses GitHub-Repository (Backend, Frontend, Scripts, Docs).
- Theme-Sync: Separat über GitHub→Shopify (Shopify GitHub-App oder CI mit Shopify CLI). Im Theme muss der Launcher eingebunden sein (Liquid-Snippet/Script-Tag), das auf `https://app.wirzapp.ch/...` zeigt.
- Designer-Assets: Produktionsquelle ist der Build aus `frontend/dist`, synchronisiert nach `backend/public/designer` und auf den Server unter `/opt/wallpaper-app/public/designer` deployt.

## Lokale Entwicklung

- Backend lokal (Port 3001, loopback):
  - Start (PM2 lokal optional) oder `node`/`npm run dev` gemäß Projekt-Setup.
  - Healthcheck: `http://127.0.0.1:3001/healthz`.
  - Statisches Testen: `http://127.0.0.1:3001/designer/index.html`.

- Frontend lokal (Dev-Server 8080):
  - Entwickeln auf `http://localhost:8080` (Hot-Reload über Webpack Dev Server).
  - Die UI bestimmt die Backend-URL dynamisch: `window.WALLPAPER_BACKEND` → `?backend=` → Fallback `http://localhost:3001`.

## Release/Deployment (End-to-End)

1. Frontend-Build erzeugen und Designer-Assets synchronisieren:
   - Windows-Skript: `scripts/windows/deploy-designer.ps1` (Option `-Build` baut das Frontend und deployt die Assets unter `/opt/wallpaper-app/public/designer`).
2. Backend-Änderungen deployen:
   - `scripts/windows/deploy-backend.ps1` (lädt Backend-Dateien hoch und startet/reloadet den PM2-Prozess `wallpaper-backend`).
3. Verifizieren:
   - `https://app.wirzapp.ch/designer/index.html` muss erreichbar sein und der Build muss identisch mit `http://127.0.0.1:3001/designer/index.html` sein.
   - Health: `https://app.wirzapp.ch/healthz` (via Proxy), intern: `curl -I http://127.0.0.1:3001/healthz`.
4. Optionaler Artefakt-Snapshot:
   - `scripts/windows/snapshot-prod-designer.ps1` speichert `designer-main.js` nach `shared/remote-snapshots/` und schreibt Größe/Hash (Revisionssicherheit).

## Betrieb/Fehlerbehebung

- 502 Gateway Error extern:
  - `scripts/windows/fix-502.ps1` ausführen: prüft SSH, PM2, deployt ggf. Designer-Assets, lädt PM2 neu, zeigt Nginx-vHost und Error-Log an, curl’t lokale Upstreams.
  - Prüfen, ob Backend auf `127.0.0.1:3001` lauscht, PM2-Prozess läuft und `index.html` unter `/opt/wallpaper-app/public/designer` vorhanden ist.
  - Nginx-Logs (z. B. `/var/log/nginx/error.log`) auf Upstream-Fehler/Timeouts prüfen.

- Cache-Busting:
  - Launcher/Seitenaufrufe können `_ts=<unix>` oder eine Build-`Version` anfügen, um CDN/Browser-Caches zu invalidieren.

## Zugangsdaten und sichere Ablage

Zur Sicherheit werden hier keine sensitiven Zugangsdaten oder Schlüssel im Klartext dokumentiert. Bitte folgende Praxis verwenden:

- SSH-Zugang zum Server
  - Host: `app.wirzapp.ch`
  - User: `martin`
  - Key: per Nutzer-SSH-Agent, typischer Pfad `~/.ssh/id_ed25519` oder projektspezifische Datei.
  - Beispiel `~/.ssh/config` (lokal, nicht committen):
    ```
    Host app.wirzapp.ch
      HostName app.wirzapp.ch
      User martin
      IdentityFile C:\\Users\\<you>\\.ssh\\id_ed25519
      IdentitiesOnly yes
    ```

- Server-Pfade/Prozesse
  - App-Root: `/opt/wallpaper-app`
  - Static: `/opt/wallpaper-app/public/designer`
  - PM2-Prozess: `wallpaper-backend`

- Shopify/GitHub
  - Theme-Sync per Shopify GitHub-App oder CI (GitHub Actions) mit Secrets (API Keys/Tokens) im GitHub-Repository als „Actions Secrets“ verwalten.
  - Shopify-Zugangsdaten in Passwortmanager/Secret Store, niemals im Repo.

- .env/Runtime-Secrets
  - Server-seitig als Umgebungsvariablen oder `.env` hinterlegt (nicht commiten). Zugriff nur für Operations.

Wenn Zugriffsdaten geändert werden, bitte `README.md`/dieses Dokument nicht mit Klartextdaten aktualisieren, sondern lediglich Speicherort/Verantwortliche vermerken.

## Relevante Skripte (Windows)

- `scripts/windows/deploy-designer.ps1` – Frontend bauen (optional) und Assets deployen.
- `scripts/windows/deploy-backend.ps1` – Backend-Dateien übertragen und PM2 neu starten.
- `scripts/windows/fix-502.ps1` – Automatisierte Diagnose/Heilung von 502/Proxy-Problemen.
- `scripts/windows/snapshot-prod-designer.ps1` – Live-Bundle speichern, Größe/Hash protokollieren.

## Kurze Checkliste „von lokal nach Produktion“

- [ ] Änderungen lokal testen (Frontend @8080, Backend @3001).
- [ ] Frontend produzieren und deployen (`deploy-designer.ps1 -Build`).
- [ ] Backend-Änderungen deployen (`deploy-backend.ps1`).
- [ ] Verifikation: `/healthz` OK, `/designer/index.html` lädt ohne 502.
- [ ] Optional: Snapshot des Live-Bundles erstellen.
- [ ] Theme-Referenzen (Launcher) prüfen; bei Theme-Änderungen GitHub→Shopify-Sync anstoßen.

---

Hinweis: Diese Dokumentation vermeidet bewusst die Nennung vertraulicher Zugangsdaten. Bewahren Sie Schlüssel/Passwörter ausschließlich in sicheren Secret Stores auf und teilen Sie sie nicht im Klartext.
