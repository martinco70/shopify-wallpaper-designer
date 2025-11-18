param(
  [string]$RemoteHost = 'app.wirzapp.ch',
  [string]$User = 'martin',
  [int]$Port = 22,
  [string]$Pm2Name = 'wallpaper-backend',
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

$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$backend = Join-Path $repo 'backend'
$remoteRoot = '/opt/wallpaper-app'

# Build summary of planned uploads and actions
$coreFiles = @('index.js','config-store.js','materials.json','ecosystem.config.js')
$serviceFiles = @()
if (Test-Path (Join-Path $backend 'services')) {
  $serviceFiles = (Get-ChildItem -Path (Join-Path $backend 'services') -File -Filter '*.js' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}
$pubFiles = @()
if (Test-Path (Join-Path $backend 'public')) {
  $pubFiles = (Get-ChildItem -Path (Join-Path $backend 'public') -File -Include 'logo.png','logo.jpg','logo.jpeg','wpd-launcher.js' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}
$summary = @()
$summary += ("Upload core files -> {0}@{1}:{2}/backend/" -f $User,$RemoteHost,$remoteRoot)
if ($serviceFiles.Count -gt 0) { $summary += ("Upload services (*.js) -> {0}@{1}:{2}/backend/services/" -f $User,$RemoteHost,$remoteRoot) }
if ($pubFiles.Count -gt 0) { $summary += ("Upload public assets (" + ($pubFiles -join ', ') + ") -> {0}@{1}:{2}/backend/public/" -f $User,$RemoteHost,$remoteRoot) }
$summary += ("PM2 reload/restart '{0}'" -f $Pm2Name)

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

Write-Host "Uploading backend core files ..." -ForegroundColor Cyan
$files = @('index.js','config-store.js','materials.json','ecosystem.config.js')
foreach ($f in $files) {
  $src = Join-Path $backend $f
  if (Test-Path $src) {
    $dst = "$remoteRoot/backend/$f"
    $target = "$User@$RemoteHost`:$dst"
    scp -P $Port $src $target
  }
}

# Ensure backend/services is synced (fix MODULE_NOT_FOUND for ./services/*)
Write-Host "Uploading backend/services ..." -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "mkdir -p $remoteRoot/backend/services" | Out-Null
$servicesDir = Join-Path $backend 'services'
if (Test-Path $servicesDir) {
  $serviceFiles = Get-ChildItem -Path $servicesDir -File -Filter '*.js' -ErrorAction SilentlyContinue
  foreach ($sf in $serviceFiles) {
    $dst = "$remoteRoot/backend/services/$($sf.Name)"
    scp -P $Port $sf.FullName "$User@$RemoteHost`:$dst"
  }
}

# Ensure backend/public exists and upload public assets (logos + launcher)
Write-Host "Ensuring backend/public exists and uploading public assets ..." -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "mkdir -p $remoteRoot/backend/public" | Out-Null
$publicDir = Join-Path $backend 'public'
if (Test-Path $publicDir) {
  $pubFiles = Get-ChildItem -Path $publicDir -File -Include 'logo.png','logo.jpg','logo.jpeg','wpd-launcher.js' -ErrorAction SilentlyContinue
  foreach ($pf in $pubFiles) {
    try {
      $dst = "$remoteRoot/backend/public/$($pf.Name)"
      scp -P $Port $pf.FullName "$User@$RemoteHost`:$dst"
    } catch { Write-Warning ("Failed to upload {0}: {1}" -f $pf.Name, $_.Exception.Message) }
  }
}

Write-Host "Restarting PM2 (update env) ..." -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "cd $remoteRoot && (pm2 startOrReload backend/ecosystem.config.js --update-env || pm2 reload $Pm2Name --update-env || pm2 restart $Pm2Name --update-env || pm2 start backend/index.js --name $Pm2Name --time); pm2 save || true"

Write-Host "Probing healthz ..." -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "curl -sS -I http://127.0.0.1:3001/healthz || true"
