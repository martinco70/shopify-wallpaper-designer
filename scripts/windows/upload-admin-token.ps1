param(
  [Parameter(Mandatory=$true)][string]$Shop, # myshopify name WITHOUT .myshopify.com
  [Parameter(Mandatory=$true)][string]$Token, # Admin API access token (write/read_products at least)
  [string]$RemoteHost = '37.27.208.130',
  [string]$User = 'root',
  [int]$Port = 22
)

$ErrorActionPreference = 'Stop'

function Test-Command([string]$cmd) {
  try { Get-Command $cmd -ErrorAction Stop | Out-Null }
  catch { throw "Required command not found: $cmd. Please install or add to PATH." }
}

Test-Command ssh
Test-Command scp

$shopNorm = $Shop.Trim().ToLower() -replace '^https?://','' -replace '\.myshopify\.com$',''
if(-not $shopNorm){ throw 'Invalid -Shop value. Expected myshopify name without domain.' }

$tmp = New-TemporaryFile
@{ access_token = $Token } | ConvertTo-Json | Set-Content -Path $tmp -Encoding UTF8

$remoteDir = '/opt/wallpaper-app/backend/tokens'
$remoteFile = "$remoteDir/$shopNorm-admin.json"

Write-Host "Creating tokens dir on server…" -ForegroundColor Cyan
ssh -p $Port "$User@$RemoteHost" "mkdir -p $remoteDir && chmod 700 $remoteDir" | Out-Null

Write-Host "Uploading admin token for $shopNorm …" -ForegroundColor Cyan
scp -P $Port $tmp "$User@$RemoteHost`:$remoteFile"
ssh -p $Port "$User@$RemoteHost" "chmod 600 $remoteFile"

Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Write-Host "Done. Token stored at $remoteFile" -ForegroundColor Green
