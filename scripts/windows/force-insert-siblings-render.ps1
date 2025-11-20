param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8
$modified = $false

# If snippet render already present, do nothing
if($content -match "\{\%\s*render\s+'product-siblings-inline'\s*\%\}"){
  Write-Host "Render already present in $FileRel" -ForegroundColor Yellow
  exit 0
}

# Prefer inserting in a case block if it exists
$caseRx = "(?im)^\s*\{\%\-?\s*case\s+block\.type\s*\-?\%\}"
$mCase = [regex]::Match($content, $caseRx)
if($mCase.Success){
  $lineEnd = $content.IndexOf("`n", $mCase.Index)
  if($lineEnd -lt 0){ $lineEnd = $content.Length }
  $caseLine = $content.Substring($mCase.Index, ($lineEnd - $mCase.Index))
  $indent = ([regex]::Match($caseLine, "^(\s*)")).Groups[1].Value
  $injection = "`n$indent  {% when 'siblings_grid' %}`n$indent    {% render 'product-siblings-inline' %}`n"
  $insertPos = $lineEnd + 1
  $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
  $modified = $true
} else {
  # Fallback: insert right after for block start
  $loopRx = "(?im)^\s*\{\%\-?\s*for\s+block\s+in\s+section\.blocks\s*\-?\%\}"
  $mLoop = [regex]::Match($content, $loopRx)
  if(-not $mLoop.Success){ throw "Could not find for block in $FileRel" }
  $lineEnd = $content.IndexOf("`n", $mLoop.Index)
  if($lineEnd -lt 0){ $lineEnd = $content.Length }
  $loopLine = $content.Substring($mLoop.Index, ($lineEnd - $mLoop.Index))
  $indent = ([regex]::Match($loopLine, "^(\s*)")).Groups[1].Value
  $injection = "`n$indent  {% if block.type == 'siblings_grid' %}{% render 'product-siblings-inline' %}{% endif %}`n"
  $insertPos = $lineEnd + 1
  $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
  $modified = $true
}

if($modified){
  Set-Content -Path $file -Value $content -Encoding UTF8
  git -C $ThemeRepo add $FileRel | Out-Null
  try { git -C $ThemeRepo pull --rebase | Out-Null } catch { }
  git -C $ThemeRepo commit -m "feat(pdp): render siblings_grid via product-siblings-inline in main-product section" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Render inserted and pushed." -ForegroundColor Green
} else {
  Write-Host "No changes made." -ForegroundColor Yellow
}
