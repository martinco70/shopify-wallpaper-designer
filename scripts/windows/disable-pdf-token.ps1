param(
  [string]$RemoteHost = 'app.wirzapp.ch',
  [string]$User = 'ubuntu',
  [int]$Port = 22,
  [string]$IdentityFile,
  [string]$Service = 'wpd.service'
)

$ErrorActionPreference = 'Stop'

function Invoke-SSH([string]$remoteCmd) {
  $sshExe = (Get-Command ssh.exe -ErrorAction Stop).Path
  $base = @('-o','BatchMode=yes','-p',"$Port")
  if ($IdentityFile) { $base += @('-i', $IdentityFile) }
  $cmdArgs = $base + ("$User@$RemoteHost"), $remoteCmd
  $out = & $sshExe @cmdArgs
  if ($LASTEXITCODE -ne 0) { throw "SSH command failed ($LASTEXITCODE): $remoteCmd" }
  return ($out -join "`n")
}

Write-Host "[1/3] Prüfe SSH" -ForegroundColor Cyan
Invoke-SSH "echo OK"

Write-Host "[2/3] Systemd-Override setzen: PDF_TOKEN_SECRET leeren" -ForegroundColor Cyan
$remote = @(
  'set -e',
  'sudo mkdir -p /etc/systemd/system/' + $Service + '.d',
  # Reset EnvironmentFile (so vars from /etc/shopify-wallpaper-designer.env do not override) and force empty PDF_TOKEN_SECRET
  (
    'cat > /tmp/override.conf <<EOF',
    '[Service]',
    'EnvironmentFile=',
    'Environment="PDF_TOKEN_SECRET="',
    'EOF'
  ) -join "\n",
  'sudo mv /tmp/override.conf /etc/systemd/system/' + $Service + '.d/override.conf',
  'sudo chown root:root /etc/systemd/system/' + $Service + '.d/override.conf',
  'sudo chmod 644 /etc/systemd/system/' + $Service + '.d/override.conf',
  'sudo systemctl daemon-reload',
  'sudo systemctl restart ' + $Service,
  # Show quick status and effective MainPID
  'sleep 1; systemctl is-active ' + $Service + ' || (journalctl -u ' + $Service + ' -n 50; exit 1)',
  'echo --- EFFECTIVE ENV (from /proc) ---',
  'pid=$(systemctl show -p MainPID --value ' + $Service + ')',
  'if [ -n "$pid" ] && [ -r /proc/$pid/environ ]; then tr "\0" "\n" < /proc/$pid/environ | grep -n "^PDF_TOKEN_SECRET=" || true; fi'
) -join ' && '
Invoke-SSH $remote

Write-Host "[3/3] Smoke-Test Backend-Port" -ForegroundColor Cyan
try {
  Invoke-SSH "curl -sS -I http://127.0.0.1:3001/ | head -n1"
} catch {
  Write-Warning $_.Exception.Message
}

Write-Host "Fertig: PDF-Signaturen sind deaktiviert (per systemd Override)." -ForegroundColor Green
