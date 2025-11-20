param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)
$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8
if($content -match 'siblings-debug-marker'){ Write-Host 'Debug marker already present.' -ForegroundColor Yellow; exit 0 }
$needle = "{% render 'product-siblings-inline' %}"
$idx = $content.IndexOf($needle)
if($idx -lt 0){ throw "Render line not found to place debug marker." }
$insert = "<!-- siblings-debug-marker: inline render present -->`n"
$new = $content.Substring(0, $idx) + $insert + $content.Substring($idx)
Set-Content -Path $file -Value $new -Encoding UTF8
git -C $ThemeRepo add $FileRel | Out-Null
git -C $ThemeRepo commit -m "chore: add siblings-debug-marker near inline render" | Out-Null
git -C $ThemeRepo push origin main | Out-Null
Write-Host "Committed and pushed debug marker." -ForegroundColor Green
