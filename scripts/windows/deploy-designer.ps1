param(
  [Parameter(Mandatory=$true)][string]$RemoteHost,
  [Parameter(Mandatory=$true)][string]$User,
  [Parameter(Mandatory=$true)][string]$RemoteDir,
  [string]$Pm2Name = 'wallpaper-backend',
  [int]$Port = 22,
  [switch]$Build,
  [string]$Version = '20250902-10',
  [switch]$CleanOld,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Test-Command([string]$cmd) {
  try { Get-Command $cmd -ErrorAction Stop | Out-Null }
  catch { throw "Required command not found: $cmd. Please install or add to PATH." }
}

Test-Command ssh
Test-Command scp
Test-Command powershell

# Resolve repo root as the directory containing this script (../../)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')
Set-Location $repo
Write-Host "Repo root: $repo" -ForegroundColor Cyan

# Pre-compute remote base locations for summary
$remoteBase = if ($RemoteDir -match "/public/([^/]+)") { $RemoteDir -replace "/designer$","" } else { (Split-Path -Path $RemoteDir -Parent) }
$backendPublic = $null
if ($RemoteDir -match "/public/designer$") {
  $backendPublic = $RemoteDir -replace "/public/designer$","/backend/public"
}

# Summary and confirmation
$summary = @()
if ($Build) { $summary += 'Build frontend (npm run build) and copy dist -> backend/public/designer' }
$summary += ("Ensure remote dir: {0}@{1}:{2}" -f $User,$RemoteHost,$RemoteDir)
$summary += ("Upload designer bundle -> {0}@{1}:{2}" -f $User,$RemoteHost,$RemoteDir)
if ($remoteBase) { $summary += ("Upload wpd-launcher.js -> {0}@{1}:{2}" -f $User,$RemoteHost,$remoteBase) }
if ($backendPublic) { $summary += ("Upload wpd-launcher.js -> {0}@{1}:{2}" -f $User,$RemoteHost,$backendPublic) }
if ($CleanOld) { $summary += 'Clean old versioned launcher files on remote targets' }
$summary += ("PM2 reload '{0}'" -f $Pm2Name)

if ($DryRun) {
  Write-Host '[dry-run] Planned actions:' -ForegroundColor Yellow
  $summary | ForEach-Object { Write-Host (' - ' + $_) -ForegroundColor Yellow }
  return
}
if (-not $Force) {
  Write-Host 'Planned actions:' -ForegroundColor Cyan
  $summary | ForEach-Object { Write-Host (' - ' + $_) }
  $ans = Read-Host 'Proceed? (y/N)'
  if ($ans -ne 'y') { Write-Host 'Aborted by user.' -ForegroundColor Yellow; return }
}

if ($Build) {
  Write-Host "Building frontend (production)..." -ForegroundColor Cyan
  Push-Location (Join-Path $repo 'frontend')
  try {
  Test-Command npm
    npm run build
  } finally {
    Pop-Location
  }
  Write-Host "Syncing build to backend/public/designer..." -ForegroundColor Cyan
  if (-not (Test-Path 'backend\public\designer')) { New-Item -ItemType Directory -Path 'backend\public\designer' | Out-Null }
  Copy-Item -Force -Path 'frontend\dist\*' -Destination 'backend\public\designer'
}

# Ensure remote directory exists
Write-Host "Preparing remote directory: $RemoteDir on $User@$RemoteHost" -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "mkdir -p '$RemoteDir'" | Out-Null

# Copy designer bundle
Write-Host ("Uploading designer bundle to {0}@{1}:{2}" -f $User,$RemoteHost,$RemoteDir) -ForegroundColor Cyan
scp -P $Port -r "backend/public/designer/*" ("{0}@{1}:{2}/" -f $User,$RemoteHost,$RemoteDir)

# Also upload launcher script to both the site root (public) and the designer directory
Write-Host ("Uploading launcher (wpd-launcher.js) to designer dir {0}@{1}:{2}" -f $User,$RemoteHost,$RemoteDir) -ForegroundColor Cyan
try {
  scp -P $Port "backend/public/wpd-launcher.js" ("{0}@{1}:{2}/" -f $User,$RemoteHost,$RemoteDir)
  scp -P $Port "backend/public/wpd-launcher.js" ("{0}@{1}:{2}/wpd-launcher-{3}.js" -f $User,$RemoteHost,$RemoteDir,$Version)
} catch { Write-Warning ("Could not upload wpd-launcher.js to designer dir: {0}" -f $_.Exception.Message) }
if ($remoteBase) {
  Write-Host ("Uploading launcher (wpd-launcher.js) to site root {0}@{1}:{2}" -f $User,$RemoteHost,$remoteBase) -ForegroundColor Cyan
  try {
    scp -P $Port "backend/public/wpd-launcher.js" ("{0}@{1}:{2}/" -f $User,$RemoteHost,$remoteBase)
    scp -P $Port "backend/public/wpd-launcher.js" ("{0}@{1}:{2}/wpd-launcher-{3}.js" -f $User,$RemoteHost,$remoteBase,$Version)
  } catch { Write-Warning ("Could not upload wpd-launcher.js to site root: {0}" -f $_.Exception.Message) }
}

# Upload launcher to backend/public as well (where Express serves from)
if ($backendPublic) {
  Write-Host ("Uploading launcher to backend public {0}@{1}:{2}" -f $User,$RemoteHost,$backendPublic) -ForegroundColor Cyan
  try {
    scp -P $Port "backend/public/wpd-launcher.js" ("{0}@{1}:{2}/" -f $User,$RemoteHost,$backendPublic)
    scp -P $Port "backend/public/wpd-launcher.js" ("{0}@{1}:{2}/wpd-launcher-{3}.js" -f $User,$RemoteHost,$backendPublic,$Version)
  } catch { Write-Warning ("Could not upload wpd-launcher.js to backend public: {0}" -f $_.Exception.Message) }
}

# Optionally remove old versioned launcher files on the remote target(s)
if ($CleanOld) {
  Write-Host "Cleaning old versioned launcher files on remote..." -ForegroundColor Yellow
  $targets = @()
  if ($RemoteDir) { $targets += $RemoteDir }
  if ($remoteBase) { $targets += $remoteBase }
  if ($backendPublic) { $targets += $backendPublic }
  foreach ($t in $targets | Select-Object -Unique) {
    try {
      $cmd = "set -e; if [ -d '$t' ]; then echo 'Cleaning $t'; find '$t' -maxdepth 1 -type f -name 'wpd-launcher-*.js' -print -delete; fi"
      ssh -p $Port "$User@$RemoteHost" $cmd | Write-Host
    } catch { Write-Warning ("Cleanup failed for {0}: {1}" -f $t, $_.Exception.Message) }
  }
}

# Verify remotely that the launcher contains price logic
try {
  Write-Host "Verifying remote launcher content..." -ForegroundColor Cyan
  if ($remoteBase) {
    ssh -p $Port "$User@$RemoteHost" "echo '-- verifying: $remoteBase/wpd-launcher.js'; grep -n 'readVariantPriceFromDOM' '$remoteBase/wpd-launcher.js' || true; wc -c '$remoteBase/wpd-launcher.js' || true" | Write-Host
    ssh -p $Port "$User@$RemoteHost" "echo '-- verifying: $remoteBase/wpd-launcher-$Version.js'; grep -n 'readVariantPriceFromDOM' '$remoteBase/wpd-launcher-$Version.js' || true; wc -c '$remoteBase/wpd-launcher-$Version.js' || true" | Write-Host
  }
  ssh -p $Port "$User@$RemoteHost" "echo '-- verifying: $RemoteDir/wpd-launcher.js'; grep -n 'readVariantPriceFromDOM' '$RemoteDir/wpd-launcher.js' || true; wc -c '$RemoteDir/wpd-launcher.js' || true" | Write-Host
  ssh -p $Port "$User@$RemoteHost" "echo '-- verifying: $RemoteDir/wpd-launcher-$Version.js'; grep -n 'readVariantPriceFromDOM' '$RemoteDir/wpd-launcher-$Version.js' || true; wc -c '$RemoteDir/wpd-launcher-$Version.js' || true" | Write-Host
  if ($backendPublic) {
    ssh -p $Port "$User@$RemoteHost" "echo '-- verifying: $backendPublic/wpd-launcher.js'; grep -n 'readVariantPriceFromDOM' '$backendPublic/wpd-launcher.js' || true; wc -c '$backendPublic/wpd-launcher.js' || true" | Write-Host
    ssh -p $Port "$User@$RemoteHost" "echo '-- verifying: $backendPublic/wpd-launcher-$Version.js'; grep -n 'readVariantPriceFromDOM' '$backendPublic/wpd-launcher-$Version.js' || true; wc -c '$backendPublic/wpd-launcher-$Version.js' || true" | Write-Host
  }
} catch {
  Write-Warning "Launcher verification step failed (non-fatal)."
}

# Reload PM2 process (non-fatal if PM2 not present)
Write-Host "Reloading PM2 process '$Pm2Name' (if present)..." -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "pm2 reload $Pm2Name || pm2 restart $Pm2Name || true" | Out-Null

Write-Host "Deploy complete." -ForegroundColor Green
