Snapshot/Restore Guide

Create a snapshot (zip):
- Windows PowerShell:
  - cd C:\Users\Public\shopify-wallpaper-designer
  - powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup.ps1 -Name "stable-2025-08-26"
  - Output: .\snapshots\<timestamp>-stable-2025-08-26.zip

Restore from a snapshot:
- Windows PowerShell:
  - cd C:\Users\Public\shopify-wallpaper-designer
  - powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore.ps1 -ZipPath .\snapshots\<your-zip>.zip

Notes:
- The zip includes backend, frontend, shared, .github, README, workspace file, and .gitignore; it also captures your .env files (secrets) if present.
- After restore, run npm install in backend/frontend if needed.
- If you later install Git, you can commit and tag snapshots, but this script works without Git.
