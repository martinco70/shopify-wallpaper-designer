param(
  [string]$RemoteHost = '37.27.208.130',
  [string]$User = 'root',
  [int]$Port = 22,
  [string]$RemoteRoot = '/opt/wallpaper-app'
)

$ErrorActionPreference = 'Stop'

function Test-Command([string]$cmd) {
  try { Get-Command $cmd -ErrorAction Stop | Out-Null }
  catch { throw "Required command not found: $cmd. Please install or add to PATH." }
}

Test-Command ssh

# Local files to compare
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$localItems = @(
  @{ rel = 'backend/index.js'; remote = "$RemoteRoot/backend/index.js" },
  @{ rel = 'backend/public/wpd-launcher.js'; remote = "$RemoteRoot/backend/public/wpd-launcher.js" },
  @{ rel = 'backend/public/designer/index.html'; remote = "$RemoteRoot/public/designer/index.html" }
)

Write-Host '== LOCAL SHA256 ==' -ForegroundColor Cyan
$localJson = @()
foreach ($it in $localItems) {
  $p = Join-Path $repo $it.rel
  if (Test-Path $p) {
    $hash = Get-FileHash -Path $p -Algorithm SHA256
    $size = (Get-Item $p).Length
    "LOCAL `t $($it.rel) `t size=$size `t sha256=$($hash.Hash)" | Write-Host
    $localJson += [pscustomobject]@{ side='local'; rel=$it.rel; remote=$it.remote; size=$size; sha256=$hash.Hash }
  } else {
    "LOCAL `t $($it.rel) `t MISSING" | Write-Host
    $localJson += [pscustomobject]@{ side='local'; rel=$it.rel; remote=$it.remote; size=-1; sha256='MISSING' }
  }
}

Write-Host "`n== REMOTE PATHS/PM2/HEALTH ==" -ForegroundColor Cyan
<#
 Build remote bash script lines. Avoid complex quoting inside PowerShell by using single quotes
 and here-doc style concatenation.
#>
$prelude = @(
  "echo '== PATH CHECK =='",
  "for p in '$RemoteRoot' '$RemoteRoot/backend' '$RemoteRoot/public/designer'; do if [ -d \"$p\" ]; then echo \"DIR $p: OK\"; else echo \"DIR $p: MISSING\"; fi; done",
  "echo",
  "echo '== PM2 =='",
  "if command -v pm2 >/dev/null 2>&1; then pm2 describe wallpaper-backend || pm2 ls; else echo 'pm2 not found'; fi",
  "echo",
  param(
    [string]$RemoteHost = '37.27.208.130',
    [string]$User = 'root',
    [int]$Port = 22,
    [string]$RemoteRoot = '/opt/wallpaper-app'
  )

  $ErrorActionPreference = 'Stop'

  function Test-Command([string]$cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null }
    catch { throw "Required command not found: $cmd. Please install or add to PATH." }
  }

  Test-Command ssh

  # Local files to compare
  $repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
  $localItems = @(
    @{ rel = 'backend/index.js'; remote = "$RemoteRoot/backend/index.js" },
    @{ rel = 'backend/public/wpd-launcher.js'; remote = "$RemoteRoot/backend/public/wpd-launcher.js" },
    @{ rel = 'backend/public/designer/index.html'; remote = "$RemoteRoot/public/designer/index.html" }
  )

  Write-Host '== LOCAL SHA256 ==' -ForegroundColor Cyan
  $localJson = @()
  foreach ($it in $localItems) {
    $p = Join-Path $repo $it.rel
    if (Test-Path $p) {
      $hash = Get-FileHash -Path $p -Algorithm SHA256
      $size = (Get-Item $p).Length
      "LOCAL`t$($it.rel)`tsize=$size`tsha256=$($hash.Hash)" | Write-Host
      $localJson += [pscustomobject]@{ side='local'; rel=$it.rel; remote=$it.remote; size=$size; sha256=$hash.Hash }
    } else {
      "LOCAL`t$($it.rel)`tMISSING" | Write-Host
      $localJson += [pscustomobject]@{ side='local'; rel=$it.rel; remote=$it.remote; size=-1; sha256='MISSING' }
    }
  }

  # Build remote script via single-quoted here-string to avoid PowerShell variable expansion
  $hashLines = @()
  foreach ($it in $localItems) {
    $rf = $it.remote
    $hashLines += "if [ -f '$rf' ]; then size=$(stat -c %s '$rf' 2>/dev/null || echo 0); if command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum '$rf' | awk '{print $1}'); elif command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 '$rf' | awk '{print $1}'); else h='no-sha256'; fi; echo '$rf size='${size}' sha256='${h}; else echo '$rf MISSING'; fi"
  }
  $remoteScript = @'
  echo "== PATH CHECK =="
  for p in "__ROOT__" "__ROOT__/backend" "__ROOT__/public/designer"; do if [ -d "$p" ]; then echo "DIR $p: OK"; else echo "DIR $p: MISSING"; fi; done
  echo
  echo "== PM2 =="
  if command -v pm2 >/dev/null 2>&1; then pm2 describe wallpaper-backend || pm2 ls; else echo "pm2 not found"; fi
  echo
  echo "== HEALTHZ =="
  (curl -sS -I http://127.0.0.1:3001/healthz | head -n1) || true
  echo
  echo "== HASHES =="
  __HASH_LINES__
  '@
  $remoteScript = $remoteScript -replace '__ROOT__',$RemoteRoot -replace '__HASH_LINES__',($hashLines -join "\n")

  Write-Host "`n== REMOTE (attempt) ==" -ForegroundColor Cyan
  try {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -p $Port "$User@$RemoteHost" "bash -lc '$remoteScript'"
  } catch {
    Write-Warning "SSH remote check failed: $($_.Exception.Message)"
  }

  Write-Host "`nDone. Compare LOCAL vs REMOTE above for parity." -ForegroundColor Green
