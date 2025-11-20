param(
  [string]$RemoteHost = 'app.wirzapp.ch',
  [string]$User = 'ubuntu',
  [int]$Port = 22,
  [string]$IdentityFile,
  [string]$SiteFile = '/etc/nginx/sites-available/app.wirzapp.ch',
  [string]$Snippet = '/etc/nginx/snippets/wpd-code-pdf.conf'
)

$ErrorActionPreference = 'Stop'

function Test-Cmd([string]$name) {
  try { Get-Command $name -ErrorAction Stop | Out-Null } catch { throw "Benötigtes Kommando nicht gefunden: $name" }
}

function SSH([string]$remoteCmd) {
  $sshExe = (Get-Command ssh.exe -ErrorAction Stop).Path
  $base = @('-o','BatchMode=yes','-p',"$Port")
  if ($IdentityFile) { $base += @('-i', $IdentityFile) }
  $cmdArgs = $base + ("$User@$RemoteHost"), $remoteCmd
  Write-Host ("SSH > {0}" -f $remoteCmd) -ForegroundColor DarkGray
  $out = & $sshExe @cmdArgs
  if ($LASTEXITCODE -ne 0) { throw "SSH command failed ($LASTEXITCODE): $remoteCmd" }
  return ($out -join "`n")
}

function SCPUpload([string]$local,[string]$remote) {
  $scpExe = (Get-Command scp.exe -ErrorAction Stop).Path
  $base = @('-P',"$Port")
  if ($IdentityFile) { $base += @('-i', $IdentityFile) }
  $cmdArgs = $base + $local, ("{0}@{1}:{2}" -f $User,$RemoteHost,$remote)
  Write-Host ("SCP > {0} -> {1}:{2}" -f $local,$RemoteHost,$remote) -ForegroundColor DarkGray
  & $scpExe @cmdArgs
  if ($LASTEXITCODE -ne 0) { throw "SCP failed ($LASTEXITCODE): $local -> $remote" }
}

Write-Host "[1/5] Prüfe SSH-Tools lokal" -ForegroundColor Cyan
Test-Cmd ssh
Test-Cmd scp
Write-Host "[2/6] Prüfe SSH-Zugriff auf $User@$RemoteHost" -ForegroundColor Cyan
SSH "echo OK"

Write-Host "[3/6] Erzeuge Snippet für den Übergangs-Rewrite ($Snippet)" -ForegroundColor Cyan
$localSnippet = New-TemporaryFile
@"
# Transitional rewrite: /CODE.pdf -> /config/CODE/pdf
# Achtung: Nur Grossbuchstaben/Ziffern, 5-12 Zeichen
location ~ ^/([A-Z0-9]{5,12})\.pdf$ {
    rewrite ^/([A-Z0-9]{5,12})\.pdf$ /config/$1/pdf break;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  # starke No-Store Header gegen Stale Caches
  add_header Cache-Control "no-store, no-cache, must-revalidate" always;
  add_header Pragma "no-cache" always;
  add_header Expires "0" always;
}
"@ | Set-Content -Path $localSnippet -Encoding UTF8

SSH "sudo mkdir -p /etc/nginx/snippets && sudo touch $Snippet && sudo chown ${User}:${User} $Snippet"
SCPUpload $localSnippet $Snippet
SSH "sudo chown root:root $Snippet && sudo chmod 644 $Snippet"
Remove-Item $localSnippet -Force

Write-Host "[4/6] Binde Snippet in Site ein ($SiteFile)" -ForegroundColor Cyan
# Falls bereits eingebunden, überspringen
$checkInclude = "grep -F 'wpd-code-pdf.conf' $SiteFile >/dev/null 2>&1 && echo PRESENT || echo MISSING"
$state = SSH $checkInclude
if ($state -match 'MISSING') {
  $sed = ":a;\n$!{N;ba};\ns/}\n\s*$/    include \/etc\/nginx\/snippets\/wpd-code-pdf.conf;\n}\n/"
  SSH ("sudo cp {0} {0}.bak && sudo sed -z -i '{1}' {0}" -f $SiteFile,$sed)
  Write-Host "Snippet eingebunden (Backup: ${SiteFile}.bak)." -ForegroundColor Green
} else {
  Write-Host "Snippet bereits eingebunden." -ForegroundColor Yellow
}

Write-Host "[5/6] Teste und lade Nginx neu" -ForegroundColor Cyan
SSH "sudo nginx -t"
SSH "sudo systemctl reload nginx"

Write-Host "[6/6] Kurztest: HEAD /QZGQC5.pdf (kann 404 sein, wenn Code nicht existiert)" -ForegroundColor Cyan
try {
  $url = "https://$RemoteHost/QZGQC5.pdf?_ts=$(Get-Date -UFormat %s)"
  $resp = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  Write-Host ("HTTP {0}" -f $resp.StatusCode) -ForegroundColor Green
} catch {
  Write-Host ("Hinweis: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

Write-Host "Fertig. Der Übergangs-Rewrite ist aktiv." -ForegroundColor Green
