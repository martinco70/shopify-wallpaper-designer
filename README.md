# Shopify Wallpaper Designer

## Schnellstart

1) Backend starten
- Terminal öffnen, in `backend` wechseln, dann `npm install` und `npm start`.
- Läuft auf http://localhost:3001

2) Frontend starten
- Neues Terminal, in `frontend` wechseln, dann `npm install` und `npm start`.
- Läuft auf http://localhost:8080

3) Upload testen
- Im Frontend eine Datei wählen und hochladen.
- Dateien landen in `backend/uploads`. Vorschauen in `backend/uploads/previews`.

## Anforderungen
- Node.js 18+ und npm
- Für PDF/EPS-Vorschau: ImageMagick 7 und Ghostscript (nur auf dem Rechner/Server des Backends nötig)

## Fehlerbehebung (kurz)
- Port belegt (EADDRINUSE): beendete Node-Prozesse neu starten oder Port freigeben.
- "ImageMagick nicht installiert": ImageMagick installieren und den Dienst neu starten.
- "Ghostscript missing": Ghostscript installieren, dann Backend neu starten (für PDF/EPS nötig).
- Timeout bei Vorschau: große Dateien/komplexe Vektoren können länger dauern; erneut versuchen.

## Ordner
- `backend/` Express-API, Uploads und Vorschau-Erzeugung
- `frontend/` React-Dev-Server mit Upload-UI
- `shared/` geteilte Artefakte/Docs

## Deployment

Siehe `docs/deployment-node.md` für den vollständigen Produktionsleitfaden (PM2, Environment, signierte PDF-Links, Smoke Tests).

## Sichere Deploys (Dry-Run/Force)

Um unbeabsichtigte Änderungen zu vermeiden, unterstützen die Skripte jetzt Trockendurchläufe (Dry-Run) und eine explizite Bestätigung:

- Dry-Run: zeigt geplante Aktionen an, führt aber nichts aus
- Force: führt ohne Bestätigungsabfrage aus

Betroffene Skripte:
- `scripts/windows/sync-theme.ps1` (Theme-Sync in externes Theme-Repo)
- `scripts/windows/deploy-designer.ps1` (Frontend-Build + Upload auf Server)
- `scripts/windows/deploy-backend.ps1` (Backend-Upload + PM2 Reload)

### Beispiele

Dry-Run (nur anzeigen, was passieren würde):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/sync-theme.ps1 -RepoUrl https://github.com/martinco70/xtra-theme-shopify.git -Branch main -TargetDir C:/Users/Public/xtra-theme-shopify -SyncMap ${PWD}/sync-map.json -DryRun

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/deploy-designer.ps1 -RemoteHost 37.27.208.130 -User root -RemoteDir /opt/wallpaper-app/public/designer -Pm2Name wallpaper-backend -Port 22 -Version 20250902-12 -Build -DryRun

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/deploy-backend.ps1 -RemoteHost app.wirzapp.ch -User martin -Port 22 -Pm2Name wallpaper-backend -DryRun
```

Erzwingend (ohne Prompt):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/sync-theme.ps1 -RepoUrl https://github.com/martinco70/xtra-theme-shopify.git -Branch main -TargetDir C:/Users/Public/xtra-theme-shopify -SyncMap ${PWD}/sync-map.json -Force

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/deploy-designer.ps1 -RemoteHost 37.27.208.130 -User root -RemoteDir /opt/wallpaper-app/public/designer -Pm2Name wallpaper-backend -Port 22 -Version 20250902-12 -Build -Force

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/deploy-backend.ps1 -RemoteHost app.wirzapp.ch -User martin -Port 22 -Pm2Name wallpaper-backend -Force
```

### VS Code Tasks

Unter `.vscode/tasks.json` stehen zusätzlich Tasks bereit:
- Sync Theme (Dry Run) / (Force)
- Sync Theme (Safety) – interaktiv: erst Dry Run, dann Nachfrage, dann Force
- Deploy Designer (root) (Dry Run) / (Force)
- Deploy Designer (root) (Safety)
- Deploy backend … (Dry Run) / (Force)
- Deploy backend … (Safety)

So kannst du Deploys erst beurteilen und erst anschließend bewusst freigeben.

## CI

[![CI](https://github.com/martinco70/shopify-wallpaper-designer/actions/workflows/ci.yml/badge.svg)](https://github.com/martinco70/shopify-wallpaper-designer/actions/workflows/ci.yml)

- Baut Backend und Frontend bei Push/PR auf main.
- Lint-/Test-Schritte werden nur ausgeführt, wenn Skripte in package.json vorhanden sind.

