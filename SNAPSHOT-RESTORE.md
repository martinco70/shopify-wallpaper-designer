# Restore Snapshot 2025-09-12 12:10

Commit: c6484d0
Datum Restore: 2025-09-15

## Inhalt
- `backend/index.js` wurde auf Timeline-Version 12.09.2025 12:10 zurückgesetzt.
- Refaktorierter Zwischenstand gesichert als `backend/index.refactor-backup.js`.
- `.gitignore` erweitert (configs/, uploads/, lokale Backups).
- Placeholder `backend/configs/README.md` hinzugefügt.

## Gründe
- Wunsch nach Rückkehr zu stabilem Monolith-Zustand.
- Einfachere Fehlersuche und Layout-Verifikation (GzD PDF) vor erneuter Modularisierung.

## Nächste Optionen
1. Selektive Übernahme einzelner Verbesserungen (Rate Limiting, Fehlerbehandlung) aus Backup.
2. Schrittweise erneute Service-Extraktion (configStore, pdf, image) mit separaten Commits.
3. Automatisierte Tests für `/healthz`, `/config-sample`, `/config/:id/pdf` ergänzen.

## Hinweise
- Runtime-Daten (configs/*.json) werden nicht mehr versioniert.
- Bitte vor größerem Umbau neuen Branch anlegen (`git checkout -b refactor-next`).
