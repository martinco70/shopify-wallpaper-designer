param([string]$Name = "snapshot")
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$here\.."
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destDir = "snapshots"
if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
$zipPath = Join-Path $destDir ("$timestamp-$Name.zip")
$items = @(
  "backend",
  "frontend",
  "shared",
  ".github",
  "README.md",
  "shopify-wallpaper-designer.code-workspace",
  "package-lock.json",
  ".gitignore"
) | Where-Object { Test-Path $_ }
Compress-Archive -Path $items -DestinationPath $zipPath -Force
Write-Host "Created snapshot: $zipPath"
