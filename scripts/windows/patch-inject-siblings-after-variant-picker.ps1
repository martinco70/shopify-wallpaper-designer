param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }

$content = Get-Content -Raw -Path $file
if ($content -match "product-siblings-inline") {
  Write-Host "Already injected. Skipping." -ForegroundColor Yellow
  exit 0
}

# Try to find a 'variant_picker' block or a 'when \"variant_picker\"' branch
$whenRegexes = @(
  "when\s+'variant_picker'",
  'when\s+"variant_picker"',
  'render\s+.*variant-picker',
  'type:\s+"variant_picker"',
  "type:\s+'variant_picker'"
)

$match = $null
foreach($rx in $whenRegexes){ $m = [regex]::Match($content, $rx, 'IgnoreCase'); if($m.Success){ $match = $m; break } }
if(-not $match){ throw "Could not find variant_picker anchor in $FileRel" }

# Insert right after the anchor line
$lineStart = $content.LastIndexOf("`n", $match.Index)
if($lineStart -lt 0) { $lineStart = 0 } else { $lineStart += 1 }
$lineEnd = $content.IndexOf("`n", $match.Index)
if($lineEnd -lt 0) { $lineEnd = $content.Length }
$anchorLine = $content.Substring($lineStart, $lineEnd - $lineStart)
$indentMatch = [regex]::Match($anchorLine, "^(\s*)")
$indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }

$injection = "`n$indent  {% render 'product-siblings-inline' %}`n"

$insertPos = $lineEnd + 1
$newContent = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
Set-Content -Path $file -Value $newContent -Encoding UTF8
Write-Host "Injected product-siblings-inline near variant_picker." -ForegroundColor Green

git -C $ThemeRepo add $FileRel | Out-Null
git -C $ThemeRepo commit -m "feat(pdp): auto-render product-siblings-inline after variant_picker" | Out-Null
git -C $ThemeRepo push origin main | Out-Null
Write-Host "Committed and pushed." -ForegroundColor Green
