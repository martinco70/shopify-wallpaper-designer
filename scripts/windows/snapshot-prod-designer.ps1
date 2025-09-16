param(
  [string]$Url = 'https://app.wirzapp.ch/designer/main.js',
  [string]$OutDir = 'C:\\Users\\Public\\shopify-wallpaper-designer\\shared\\remote-snapshots',
  [string]$FileName = 'designer-main.js'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$outFile = Join-Path $OutDir $FileName

Write-Host "Downloading $Url -> $outFile ..." -ForegroundColor Cyan
try {
  try {
    Invoke-WebRequest -Uri $Url -OutFile $outFile -UseBasicParsing -TimeoutSec 30
  } catch {
    # Fallback to WebClient for older environments
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($Url, $outFile)
  }
} catch {
  Write-Error "Download failed: $($_.Exception.Message)"
  exit 1
}

if (-not (Test-Path $outFile)) { Write-Error "Download did not produce file: $outFile"; exit 2 }

$fi = Get-Item $outFile
$size = $fi.Length
$hash = (Get-FileHash -Path $outFile -Algorithm SHA256).Hash.ToLowerInvariant()
$timestamp = (Get-Date -Format o)

$meta = @(
  "Downloaded: $timestamp",
  "URL: $Url",
  "File: $outFile",
  "Size: $size",
  "SHA256: $hash"
) -join "`r`n"

Set-Content -Path (Join-Path $OutDir 'last-download.txt') -Value $meta -Encoding UTF8
Write-Host "Saved snapshot. Size=$size, SHA256=$hash" -ForegroundColor Green

# Update manifest.json
$manifestPath = Join-Path $OutDir 'manifest.json'
if (Test-Path $manifestPath) {
  try {
    $json = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($json -is [System.Array]) {
      foreach ($entry in $json) {
        if ($entry.url -eq $Url) {
          $entry.savedAs = $FileName
          $entry.savedAt = $timestamp
          $entry.sizeBytes = [long]$size
          $entry.sha256 = $hash
        }
      }
      $json | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8
      Write-Host "Manifest updated: $manifestPath" -ForegroundColor Green
    }
  } catch {
    Write-Warning "Could not update manifest.json: $($_.Exception.Message)"
  }
} else {
  $obj = @(
    @{ url = $Url; savedAs = $FileName; savedAt = $timestamp; sizeBytes = [long]$size; sha256 = $hash; notes = 'Auto-snapshotted by script.' }
  )
  $obj | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8
  Write-Host "Manifest created: $manifestPath" -ForegroundColor Green
}

exit 0
