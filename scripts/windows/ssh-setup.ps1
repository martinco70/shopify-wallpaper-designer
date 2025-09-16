param(
  [string]$Email = "you@example.com",
  [string]$KeyName = "id_ed25519",
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$sshDir = Join-Path $env:USERPROFILE ".ssh"
if (-not (Test-Path $sshDir)) {
  New-Item -ItemType Directory -Path $sshDir | Out-Null
}

$pubPath = Join-Path $sshDir ("{0}.pub" -f $KeyName)
$privPath = Join-Path $sshDir $KeyName

function Show-PubKey($path) {
  if (Test-Path $path) {
    Write-Host "Public key ($path):" -ForegroundColor Cyan
    Get-Content $path | Tee-Object -Variable pub | Out-Host
    try {
      Set-Clipboard -Value $pub
      Write-Host "Copied to clipboard." -ForegroundColor Green
    } catch {
      # Fallback to clip.exe if Set-Clipboard is unavailable
      try {
        ($pub | Out-String) | clip
        Write-Host "Copied to clipboard via clip.exe." -ForegroundColor Green
      } catch {
        Write-Warning "Could not copy to clipboard; please copy manually."
      }
    }
  }
}

# If a pubkey already exists and not forcing, just show it
if ((Test-Path $pubPath) -and -not $Force) {
  Show-PubKey $pubPath
  exit 0
}

# If any other pubkey exists, suggest using it unless forcing
$existingPubs = Get-ChildItem -Path $sshDir -Filter *.pub -ErrorAction SilentlyContinue
if ($existingPubs -and -not $Force) {
  Write-Host "Found existing public keys:" -ForegroundColor Yellow
  $existingPubs | ForEach-Object { Write-Host " - "$_.FullName }
  Write-Host "Re-run with -Force to create a new key named $KeyName, or use one of the above."
  exit 0
}

# Generate a new ed25519 key
Write-Host "Generating a new SSH key: $KeyName (ed25519)" -ForegroundColor Cyan

# Resolve ssh-keygen path (PowerShell 5.1 compatibility)
$cmd = $null
try { $cmd = Get-Command ssh-keygen -ErrorAction Stop } catch { }
if (-not $cmd) {
  $fallback = Join-Path $env:WINDIR "System32\OpenSSH\ssh-keygen.exe"
  if (Test-Path $fallback) {
    $cmd = @{ Path = $fallback }
  } else {
    throw "ssh-keygen not found. Install 'OpenSSH Client' in Windows Optional Features or ensure ssh-keygen is in PATH."
  }
}

# Use Start-Process with ArgumentList and pass explicit empty string for -N
$argList = @('-t','ed25519','-C',"$Email",'-f',"$privPath",'-N','""')
$proc = Start-Process -FilePath $cmd.Path -ArgumentList $argList -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ne 0) {
  throw "ssh-keygen failed with exit code $($proc.ExitCode)"
}

Show-PubKey $pubPath
