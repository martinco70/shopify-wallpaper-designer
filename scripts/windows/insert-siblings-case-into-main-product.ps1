param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8

if($content -match "\{\%\-?\s*when\s+'siblings_grid'\s*\-?\%\}"){
  Write-Host "siblings_grid case already present." -ForegroundColor Yellow
  exit 0
}

# Find `{% case block.type %}` with optional trim hyphens
$caseRx = "(?im)^\s*\{\%\-?\s*case\s+block\.type\s*\-?\%\}"
$m = [regex]::Match($content, $caseRx)
if(-not $m.Success){ throw "Case block for block.type not found in $FileRel" }

# Determine indentation and build injection respecting theme's trim style
$lineStart = $content.LastIndexOf("`n", $m.Index)
if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
$lineEnd = $content.IndexOf("`n", $m.Index)
if($lineEnd -lt 0){ $lineEnd = $content.Length }
$caseLine = $content.Substring($lineStart, $lineEnd - $lineStart)
$indent = ([regex]::Match($caseLine, "^(\s*)")).Groups[1].Value

$injection = "`n${indent}{%- when 'siblings_grid' -%}`n${indent}  {% render 'product-siblings-inline' %}`n"
$insertPos = $lineEnd + 1
$newContent = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)

Set-Content -Path $file -Value $newContent -Encoding UTF8
git -C $ThemeRepo add $FileRel | Out-Null
try { git -C $ThemeRepo pull --rebase | Out-Null } catch { }
git -C $ThemeRepo commit -m "feat(pdp): add when 'siblings_grid' case to render product-siblings-inline" | Out-Null
git -C $ThemeRepo push origin main | Out-Null
Write-Host "Inserted siblings_grid case and pushed." -ForegroundColor Green
