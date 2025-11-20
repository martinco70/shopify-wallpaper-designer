param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)
$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8
$m = [regex]::Match($content, '(?s)\{\%\s*schema\s*\%\}(.*?)\{\%\s*endschema\s*\%\}')
if(-not $m.Success){ throw "Schema block not found in $FileRel" }
$schema = $m.Groups[1].Value
Write-Host "----- BEGIN SCHEMA -----" -ForegroundColor Cyan
Write-Output $schema
Write-Host "----- END SCHEMA -----" -ForegroundColor Cyan