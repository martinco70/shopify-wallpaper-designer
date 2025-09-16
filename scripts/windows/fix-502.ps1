param(
  [string]$RemoteHost = 'app.wirzapp.ch',
  [string]$User = 'martin',
  [string]$RemoteDir = '/opt/wallpaper-app/public/designer',
  [string]$Pm2Name = 'wallpaper-backend',
  [int]$Port = 22,
  [string]$Version = '20250902-10',
  [switch]$Build
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

Write-Host "[1/5] Probing SSH connectivity to $User@$RemoteHost ..." -ForegroundColor Cyan
try {
  $probe = & ssh -o BatchMode=yes -p $Port "$User@$RemoteHost" "echo OK"
  if (-not $probe -or -not ($probe -match 'OK')) { throw "SSH connectivity failed (no OK)." }
  Write-Host "SSH OK" -ForegroundColor Green
} catch {
  Write-Error "Cannot reach $User@$RemoteHost via SSH: $($_.Exception.Message)"
  exit 2
}

Write-Host "[2/5] Checking PM2 and backend status ..." -ForegroundColor Cyan
$pm2Info = & ssh -p $Port "$User@$RemoteHost" "command -v pm2 >/dev/null 2>&1 || echo NO_PM2; pm2 pid $Pm2Name 2>/dev/null || true"
$hasPm2 = -not ($pm2Info -match 'NO_PM2')
$pm2Pid = $pm2Info | Select-Object -Last 1
if ($hasPm2) {
  if (-not $pm2Pid -or $pm2Pid -match '0' -or $pm2Pid -match 'not found') {
    Write-Warning "PM2 present, but $Pm2Name not running. Attempting start..."
    # Try to start from /opt/wallpaper-app if it exists
    & ssh -p $Port "$User@$RemoteHost" "if [ -d /opt/wallpaper-app ]; then cd /opt/wallpaper-app; pm2 start backend/index.js --name $Pm2Name --time || true; pm2 save || true; fi"
  } else {
    Write-Host "PM2 process $Pm2Name is running with PID $pm2Pid" -ForegroundColor Green
  }
} else {
  Write-Warning "PM2 not installed or not in PATH on remote. Skipping PM2 checks."
}

Write-Host "[3/5] Verifying designer assets on remote ($RemoteDir) ..." -ForegroundColor Cyan
$ls = & ssh -p $Port "$User@$RemoteHost" "set -e; mkdir -p '$RemoteDir'; test -f '$RemoteDir/index.html' && echo PRESENT || echo MISSING"
if ($ls -notmatch 'PRESENT') {
  Write-Warning "Designer files missing. Deploying via scripts/windows/deploy-designer.ps1 ..."
  $deployScript = Join-Path $here 'deploy-designer.ps1'
  if (-not (Test-Path $deployScript)) { throw "deploy-designer.ps1 not found at $deployScript" }
  $deployArgs = @('-ExecutionPolicy','Bypass','-File',$deployScript,'-RemoteHost',$RemoteHost,'-User',$User,'-RemoteDir',$RemoteDir,'-Pm2Name',$Pm2Name,'-Port',$Port,'-Version',$Version)
  if ($Build.IsPresent) { $deployArgs += '-Build' }
  & powershell @deployArgs
} else {
  Write-Host "Designer assets present." -ForegroundColor Green
}

Write-Host "[4/5] Restarting backend (PM2) ..." -ForegroundColor Cyan
if ($hasPm2) {
  & ssh -p $Port "$User@$RemoteHost" "pm2 reload $Pm2Name || pm2 restart $Pm2Name || true" | Out-Null
}

Write-Host "[5/5] Checking public URL (https://$RemoteHost/designer/index.html) ..." -ForegroundColor Cyan
try {
  $resp = Invoke-WebRequest -Uri ("https://{0}/designer/index.html?_ts={1}" -f $RemoteHost,[DateTimeOffset]::Now.ToUnixTimeSeconds()) -UseBasicParsing -Method Head -TimeoutSec 15 -ErrorAction Stop
  Write-Host ("HTTP {0}" -f $resp.StatusCode) -ForegroundColor Green
  if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
    Write-Host "Fix appears successful." -ForegroundColor Green
    exit 0
  }
} catch {
  Write-Warning ("Public check failed: {0}" -f $_.Exception.Message)
}

# If still failing, output quick diagnostics
Write-Host "Collecting diagnostics ..." -ForegroundColor Yellow
try { & ssh -p $Port "$User@$RemoteHost" "pm2 describe $Pm2Name || true" | Write-Host } catch {}
try { & ssh -p $Port "$User@$RemoteHost" "tail -n 100 ~/.pm2/logs/${Pm2Name}-out.log 2>/dev/null || true" | Write-Host } catch {}
try { & ssh -p $Port "$User@$RemoteHost" "tail -n 100 ~/.pm2/logs/${Pm2Name}-error.log 2>/dev/null || true" | Write-Host } catch {}
try { & ssh -p $Port "$User@$RemoteHost" "echo '=== CURL 127.0.0.1:3001 HEAD /designer/index.html ==='; curl -sS -I http://127.0.0.1:3001/designer/index.html || true; echo '=== CURL 127.0.0.1:3001 HEAD / ==='; curl -sS -I http://127.0.0.1:3001/ || true; echo '=== LISTENERS 3001 ==='; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || netstat -an 2>/dev/null) | grep -E ':3001\\s' || true; echo '=== NGINX SITE (available/enabled) ==='; (cat /etc/nginx/sites-available/app.wirzapp.ch 2>/dev/null || true); (cat /etc/nginx/sites-enabled/app.wirzapp.ch 2>/dev/null || true); echo '=== NGINX ERROR LOG (last 50) ==='; (tail -n 50 /var/log/nginx/error.log 2>/dev/null || echo 'no permissions');" | Write-Host } catch {}

Write-Error "Designer still not reachable. Please review the diagnostics above."
exit 1
