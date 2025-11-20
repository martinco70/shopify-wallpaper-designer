param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }

$content = Get-Content -Raw -Path $file -Encoding UTF8

# 1) Remove any existing/malformed lines that reference product-siblings-inline entirely
$clean = [regex]::Replace($content, "(?m)^.*product-siblings-inline.*\r?\n?", "")

# 2) Find an anchor line to insert after
$rxAnchors = @(
  "(?im)^\s*when\s+'variant_selection'",
  '(?im)^\s*when\s+"variant_selection"',
  "(?im)^\s*when\s+'variant_picker'",
  '(?im)^\s*when\s+"variant_picker"',
  '(?im)^\s*\{\%\s*render\s+[^\n]*variant-picker[^\n]*\%\}'
)

$anchorMatch = $null
foreach($rx in $rxAnchors){ $m = [regex]::Match($clean, $rx); if($m.Success){ $anchorMatch = $m; break } }
if(-not $anchorMatch){
  # Fallback: insert right before the schema block so the Liquid actually executes
  $schemaIdx = $clean.IndexOf('{% schema')
  if($schemaIdx -ge 0){
    $lineStart = $clean.LastIndexOf("`n", $schemaIdx)
    if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
    $anchorLine = $clean.Substring($lineStart, $schemaIdx - $lineStart)
    $indentMatch = [regex]::Match($anchorLine, "^(\s*)")
    $indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }
    $injection = "`n$indent{% render 'product-siblings-inline' %}`n"
    $newContent = $clean.Substring(0, $schemaIdx) + $injection + $clean.Substring($schemaIdx)
  } else {
    # If schema not found, append as last resort
    $injection = "`n{% render 'product-siblings-inline' %}`n"
    $newContent = $clean + $injection
  }
  Set-Content -Path $file -Value $newContent -Encoding UTF8
  Write-Host "Fallback-inserted render at end of file." -ForegroundColor Yellow
  git -C $ThemeRepo add $FileRel | Out-Null
  git -C $ThemeRepo commit -m "fix(pdp): fallback insert product-siblings-inline render at EOF" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Committed and pushed." -ForegroundColor Green
  exit 0
}

# Compute insertion position right after anchor line
$lineStart = $clean.LastIndexOf("`n", $anchorMatch.Index)
if($lineStart -lt 0) { $lineStart = 0 } else { $lineStart += 1 }
$lineEnd = $clean.IndexOf("`n", $anchorMatch.Index)
if($lineEnd -lt 0) { $lineEnd = $clean.Length }
$anchorLine = $clean.Substring($lineStart, $lineEnd - $lineStart)
$indentMatch = [regex]::Match($anchorLine, "^(\s*)")
$indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }

$injection = "`n$indent  {% render 'product-siblings-inline' %}`n"
$insertPos = $lineEnd + 1
$newContent = $clean.Substring(0, $insertPos) + $injection + $clean.Substring($insertPos)

Set-Content -Path $file -Value $newContent -Encoding UTF8
Write-Host "Repaired and re-inserted product-siblings-inline render." -ForegroundColor Green

git -C $ThemeRepo add $FileRel | Out-Null
git -C $ThemeRepo commit -m "fix(pdp): repair malformed product-siblings-inline render and re-insert correctly" | Out-Null
git -C $ThemeRepo push origin main | Out-Null
Write-Host "Committed and pushed." -ForegroundColor Green
