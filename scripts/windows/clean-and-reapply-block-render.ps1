param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)
$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8
$modified = $false

# Remove any renders of the snippet anywhere
$prev = $content
$content = $content -replace "\{\%\s*render\s+'product-siblings-inline'\s*\%\}", ''
if($content -ne $prev){ $modified = $true }

# Ensure loop-based conditional render exists
$loopRx = "(?im)^\s*\{\%\s*for\s+block\s+in\s+section\.blocks\s*\%\}"
$lm = [regex]::Match($content, $loopRx)
if($lm.Success){
  if($content -notmatch "(?s)\{\%\s*if\s+block\.type\s*==\s*'siblings_grid'\s*\%\}.*\{\%\s*render\s+'product-siblings-inline'\s*\%\}.*\{\%\s*endif\s*\%\}"){
    $lineStart = $content.LastIndexOf("`n", $lm.Index)
    if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
    $lineEnd = $content.IndexOf("`n", $lm.Index)
    if($lineEnd -lt 0){ $lineEnd = $content.Length }
    $loopLine = $content.Substring($lineStart, $lineEnd - $lineStart)
    $indentMatch = [regex]::Match($loopLine, "^(\s*)")
    $indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }
    $injection = "`n$indent  {% if block.type == 'siblings_grid' %}{% render 'product-siblings-inline' %}{% endif %}`n"
    $insertPos = $lineEnd + 1
    $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
    $modified = $true
  }
}

if($modified){
  Set-Content -Path $file -Value $content -Encoding UTF8
  git -C $ThemeRepo add $FileRel | Out-Null
  git -C $ThemeRepo commit -m "fix(pdp): remove stray inline renders and re-apply loop-based block render" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Cleaned and re-applied block render." -ForegroundColor Green
} else {
  Write-Host "No changes necessary." -ForegroundColor Yellow
}
