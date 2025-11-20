param(
  [Parameter(Mandatory=$true)][string]$RemoteHost,
  [string]$User = $env:USERNAME,
  [int]$Port = 22,
  [string]$RemoteDir = "/opt/wallpaper-app",
  [switch]$NoUpload,
  [string]$IdentityFile
)

$ErrorActionPreference = 'Stop'

function Ensure-Ssh() {
  try { Get-Command ssh -ErrorAction Stop | Out-Null } catch { throw "ssh not found. Install 'OpenSSH Client' in Windows Optional Features." }
  try { Get-Command scp -ErrorAction Stop | Out-Null } catch { if (-not $NoUpload) { throw "scp not found. Install 'OpenSSH Client' or pass -NoUpload to skip upload." } }
}

Ensure-Ssh

$remote = if ($User) { "$User@$RemoteHost" } else { $RemoteHost }
$scriptLocal = (Join-Path $PSScriptRoot "..\remote\check-deps.sh" | Resolve-Path).Path
# Build POSIX path for remote
if ($RemoteDir.EndsWith('/')) {
  $remoteScript = "$RemoteDir" + 'check-deps.sh'
} else {
  $remoteScript = "$RemoteDir/check-deps.sh"
}
# Ensure forward slashes
$remoteScript = $remoteScript -replace '\\','/'

# Optional identity file args for ssh/scp
$identityArgs = @()
if ($IdentityFile -and (Test-Path $IdentityFile)) {
  $identityArgs = @('-i', $IdentityFile)
}

if (-not $NoUpload) {
  Write-Host ("Uploading check script to {0}:{1}" -f $remote, $remoteScript) -ForegroundColor Cyan
  # Ensure remote directory exists
  $remoteDirPosix = ($remoteScript -replace '/[^/]+$','')
  & ssh @identityArgs -p $Port $remote ("mkdir -p '{0}'" -f $remoteDirPosix) | Out-Null
  # For scp, avoid quoting the remote path (quotes can be treated literally by scp)
  $target = ("{0}:{1}" -f $remote, $remoteScript)
  & scp @identityArgs -P $Port "$scriptLocal" $target | Out-Null
  & ssh @identityArgs -p $Port $remote ("chmod +x '{0}'" -f $remoteScript) | Out-Null
}

Write-Host "Running remote dependency check on $remote" -ForegroundColor Cyan
& ssh @identityArgs -p $Port $remote ("bash '{0}'" -f $remoteScript) | Write-Output
