param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8
$modified = $false

# Remove any stray when 'siblings_grid' lines that are not inside a proper case
$prev = $content
$content = [regex]::Replace($content, "(?m)^\s*\{\%\-?\s*when\s+'siblings_grid'\s*\-?\%\}\s*$", "")
if($content -ne $prev){ $modified = $true }

# Ensure loop-based if render after for block start
if($content -notmatch "\{\%\-?\s*if\s+block\.type\s*==\s*'siblings_grid'\s*\-?\%\}.*\{\%\s*render\s+'product-siblings-inline'\s*\%\}"){
  $loopRx = "(?im)^\s*\{\%\-?\s*for\s+block\s+in\s+section\.blocks\s*\-?\%\}"
  $m = [regex]::Match($content, $loopRx)
  if($m.Success){
    $lineStart = $content.LastIndexOf("`n", $m.Index)
    if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
    $lineEnd = $content.IndexOf("`n", $m.Index)
    if($lineEnd -lt 0){ $lineEnd = $content.Length }
    $line = $content.Substring($lineStart, $lineEnd - $lineStart)
    $indent = ([regex]::Match($line, "^(\s*)")).Groups[1].Value
    $injection = "`n${indent}{% if block.type == 'siblings_grid' %}{% render 'product-siblings-inline' %}{% endif %}`n"
    $insertPos = $lineEnd + 1
    $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
    $modified = $true
  } else {
    throw "for block over section.blocks not found; cannot insert render"
  }
}

if($modified){
  Set-Content -Path $file -Value $content -Encoding UTF8
  git -C $ThemeRepo add $FileRel | Out-Null
  try { git -C $ThemeRepo pull --rebase | Out-Null } catch { }
  git -C $ThemeRepo commit -m "fix(pdp): remove invalid when 'siblings_grid' and add loop-based render hook" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "main-product repaired and pushed." -ForegroundColor Green
} else {
  Write-Host "No changes applied (already corrected)." -ForegroundColor Yellow
}
