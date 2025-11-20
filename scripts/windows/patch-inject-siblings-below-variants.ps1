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

# Find the when 'variant_selection' case branch
$whenRegex = 'when\s+['''']variant_selection['''']'
$nextStopRegex = '(?m)^(\s*)(when\s+['''']|endcase\b)'
$m = [regex]::Match($content, $whenRegex, 'IgnoreCase')
if(-not $m.Success){ throw "Could not find when 'variant_selection' in $FileRel" }

$startIndex = $m.Index + $m.Length
# search for next when or endcase after this branch start
$tail = $content.Substring($startIndex)
$m2 = [regex]::Match($tail, $nextStopRegex)
$insertPos = if($m2.Success){ $startIndex + $m2.Index } else { $content.Length }

# Determine indentation from the when line
$lineStart = $content.LastIndexOf("`n", $m.Index)
if($lineStart -lt 0) { $lineStart = 0 } else { $lineStart += 1 }
$lineEnd = $content.IndexOf("`n", $m.Index)
if($lineEnd -lt 0) { $lineEnd = $content.Length }
$whenLine = $content.Substring($lineStart, $lineEnd - $lineStart)
$indentMatch = [regex]::Match($whenLine, "^(\s*)")
$indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }

$injection = "`n$indent  {% render 'product-siblings-inline' %}`n"

$newContent = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
Set-Content -Path $file -Value $newContent -Encoding UTF8
Write-Host "Injected product-siblings-inline under variant_selection." -ForegroundColor Green

# Git commit & push
git -C $ThemeRepo add $FileRel | Out-Null
git -C $ThemeRepo commit -m "feat(pdp): auto-render product-siblings-inline after variant_selection" | Out-Null
git -C $ThemeRepo push origin main | Out-Null
Write-Host "Committed and pushed." -ForegroundColor Green
