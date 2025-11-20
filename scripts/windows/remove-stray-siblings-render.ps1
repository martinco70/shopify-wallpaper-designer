param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }

# Read as UTF8 to preserve encoding
$content = Get-Content -Raw -Path $file -Encoding UTF8
$original = $content

# Locate the first occurrence of the siblings_grid case marker
$caseIdx = [Math]::Min(
  ($content.IndexOf("when 'siblings_grid'")),
  ($content.IndexOf('when "siblings_grid"'))
)

# If neither found, just remove duplicate unconditional renders globally except when inside a case branch
if($caseIdx -lt 0){
  # Remove any unconditional full-line renders
  $content = [regex]::Replace($content, "(?m)^\s*\{\%\s*render\s+'product-siblings-inline'\s*\%\}\s*\r?\n", '')
} else {
  # Split content around the first case marker and remove renders only before the case branch
  $before = $content.Substring(0, $caseIdx)
  $after = $content.Substring($caseIdx)
  $before2 = [regex]::Replace($before, "(?m)^\s*\{\%\s*render\s+'product-siblings-inline'\s*\%\}\s*\r?\n", '')
  $content = $before2 + $after
}

if($content -ne $original){
  Set-Content -Path $file -Value $content -Encoding UTF8
  git -C $ThemeRepo add $FileRel | Out-Null
  git -C $ThemeRepo commit -m "fix(pdp): remove stray unconditional siblings render; keep case-based block render only" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Removed stray unconditional render and pushed." -ForegroundColor Green
} else {
  Write-Host "No changes needed; file already clean." -ForegroundColor Yellow
}
