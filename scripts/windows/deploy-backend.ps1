param(
  [string]$RemoteHost = 'app.wirzapp.ch',
  [string]$User = 'martin',
  [int]$Port = 22,
  [string]$Pm2Name = 'wallpaper-backend'
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

Write-Host "Uploading backend core files ..." -ForegroundColor Cyan
$files = @('index.js','config-store.js','materials.json')
foreach ($f in $files) {
  $src = Join-Path $backend $f
  if (Test-Path $src) {
    $dst = "$remoteRoot/backend/$f"
    $target = "$User@$RemoteHost`:$dst"
    scp -P $Port $src $target
  }
}

Write-Host "Restarting PM2 ..." -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "cd $remoteRoot && pm2 reload $Pm2Name || pm2 restart $Pm2Name || pm2 start backend/index.js --name $Pm2Name --time; pm2 save || true"

Write-Host "Probing healthz ..." -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "curl -sS -I http://127.0.0.1:3001/healthz || true"
