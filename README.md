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

