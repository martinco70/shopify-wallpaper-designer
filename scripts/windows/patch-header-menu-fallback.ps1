param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$snippetPath = Join-Path $ThemeDir 'snippets/header-menu.liquid'
if (-not (Test-Path $snippetPath)) {
  Write-Error "Snippet not found: $snippetPath"
  exit 1
}

$content = Get-Content -Raw -Path $snippetPath

# Detect if fallback already present
if ($content -match "assign layout = 'mega'") {
  Write-Host '[info] Fallback already present. Nothing to do.' -ForegroundColor Yellow
  exit 0
}

# Find the opening liquid logic block
$pattern = "{%-\s*liquid"
$idx = $content.IndexOf('{%- liquid')
if ($idx -lt 0) {
  Write-Error 'Could not locate opening {%- liquid block to inject fallback.'
  exit 1
}

# Build insertion (indented to match typical style)
$injection = "{%- liquid`n  unless layout`n    assign layout = 'mega'`n  endunless"

# Replace only first occurrence
$newContent = $content.Substring(0, $idx) + $injection + $content.Substring($idx + 10)

if ($DryRun) {
  Write-Host '--- DRY RUN (showing first 300 chars after patch) ---' -ForegroundColor Cyan
  Write-Host ($newContent.Substring(0, [Math]::Min(300, $newContent.Length)))
  exit 0
}

# Backup
$backupPath = "$snippetPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Set-Content -Path $backupPath -Value $content -Encoding UTF8

# Write patched file
Set-Content -Path $snippetPath -Value $newContent -Encoding UTF8

Write-Host '[ok] Injected minimal mega-menu fallback (layout default to mega).' -ForegroundColor Green
Write-Host "Backup: $backupPath" -ForegroundColor DarkGray

# Simple verification: ensure 'assign layout = 'mega'' now present
if ($newContent -notmatch "assign layout = 'mega'") {
  Write-Warning 'Verification failed: fallback not found after write.'
} else {
  Write-Host '[verify] Fallback present.' -ForegroundColor Green
}
