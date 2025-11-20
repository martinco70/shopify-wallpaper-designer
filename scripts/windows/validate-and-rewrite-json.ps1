param(
  [string]$FilePath,
  [switch]$RewriteNoBom
)

$ErrorActionPreference = 'Stop'
if(-not (Test-Path $FilePath)) { throw "File not found: $FilePath" }
$raw = [System.IO.File]::ReadAllText($FilePath)
$header = ''
if($raw -match '^(?s)\s*/\*.*?\*/\s*'){ $header = $Matches[0] }
$clean = [regex]::Replace($raw, '^(?s)\s*/\*.*?\*/\s*','')
$clean = $clean -replace '^[\uFEFF]',''
try {
  $obj = $clean | ConvertFrom-Json -ErrorAction Stop
  Write-Host "JSON OK: $FilePath" -ForegroundColor Green
  if($RewriteNoBom){
    $json = $obj | ConvertTo-Json -Depth 100
    if($header){ $json = $header + "`r`n" + $json }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($FilePath, $json, $utf8NoBom)
    Write-Host "Rewrote without BOM: $FilePath" -ForegroundColor Cyan
  }
} catch {
  Write-Error ("Invalid JSON: {0}" -f $_.Exception.Message)
  throw
}
