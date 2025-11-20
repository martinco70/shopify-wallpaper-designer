param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$SectionRel = 'sections/main-product.liquid',
  [string]$TemplateRel = 'templates/product.tapeten.json'
)

$ErrorActionPreference = 'Stop'

function FixMainProduct([string]$filePath){
  $content = Get-Content -Raw -Path $filePath -Encoding UTF8
  $modified = $false
  # 1) Remove loop-level if-render
  $rxIf = "(?ms)^\s*\{\%\-?\s*if\s+block\.type\s*==\s*'siblings_grid'\s*\-?\%\}\s*\{\%\s*render\s+'product-siblings-inline'\s*\%\}\s*\{\%\-?\s*endif\s*\-?\%\}\s*$"
  $new = [regex]::Replace($content, $rxIf, "")
  if($new -ne $content){ $content = $new; $modified = $true }
  # 2) Remove stray when siblings_grid lines
  $rxWhen = "(?m)^\s*\{\%\-?\s*when\s+'siblings_grid'\s*\-?\%\}\s*$"
  $new = [regex]::Replace($content, $rxWhen, "")
  if($new -ne $content){ $content = $new; $modified = $true }
  # 3) Ensure when 'siblings_grid' is present immediately after `{%- case block.type -%}`
  if($content -notmatch "\{\%\-?\s*case\s+block\.type\s*\-?\%\}[\s\S]*?\{\%\-?\s*when\s+'siblings_grid'\s*\-?\%\}"){
    $caseRx = "(?im)^\s*\{\%\-?\s*case\s+block\.type\s*\-?\%\}"
    $m = [regex]::Match($content, $caseRx)
    if(-not $m.Success){ throw "Case block for block.type not found" }
    $lineStart = $content.LastIndexOf("`n", $m.Index)
    if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
    $lineEnd = $content.IndexOf("`n", $m.Index)
    if($lineEnd -lt 0){ $lineEnd = $content.Length }
    $caseLine = $content.Substring($lineStart, $lineEnd - $lineStart)
    $indent = ([regex]::Match($caseLine, "^(\s*)")).Groups[1].Value
    $injection = "`n${indent}{%- when 'siblings_grid' -%}`n${indent}  {% render 'product-siblings-inline' %}`n"
    $insertPos = $lineEnd + 1
    $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
    $modified = $true
  }
  if($modified){ Set-Content -Path $filePath -Value $content -Encoding UTF8 }
  return $modified
}

function ReorderTemplate([string]$filePath){
  $raw = Get-Content -Raw -Path $filePath -Encoding UTF8
  $header = ''
  if($raw -match '^(?s)\s*/\*.*?\*/'){
    $header = $Matches[0]
  }
  $clean = $raw -replace '^(?s)\s*/\*.*?\*/\s*',''
  $json = $clean | ConvertFrom-Json -ErrorAction Stop
  if(-not $json.sections.'main-product'){ throw "main-product section not found in template" }
  $mp = $json.sections.'main-product'
  if(-not $mp.blocks){ return $false }
  # Remove any custom_liquid that renders our snippet
  $removed = @()
  foreach($p in @($mp.blocks.PSObject.Properties)){
    $id = $p.Name; $blk = $p.Value
    $liquid = ''
    if($blk.type -eq 'custom_liquid' -and $blk.settings){
      $liquid = [string]$blk.settings.custom_liquid
      if($liquid -and $liquid -match 'product-siblings-inline'){
        $mp.blocks.PSObject.Properties.Remove($id) | Out-Null
        $removed += $id
      }
    }
  }
  if($removed.Count -gt 0 -and $mp.block_order){
    $mp.block_order = @($mp.block_order | Where-Object { $removed -notcontains $_ })
  }
  # Find siblings_grid block id
  $sibId = $null
  foreach($p in $mp.blocks.PSObject.Properties){ if($p.Value.type -eq 'siblings_grid'){ $sibId = $p.Name; break } }
  if(-not $sibId){ return ($removed.Count -gt 0) }
  # Ensure only one occurrence in block_order and move after variant_selection
  if(-not $mp.block_order){ return ($removed.Count -gt 0) }
  $order = @($mp.block_order | Where-Object { $_ -ne $sibId })
  $insertAfter = 'variant_selection'
  $idx = [Array]::IndexOf($order, $insertAfter)
  if($idx -lt 0){ $order += $sibId } else { $order = $order[0..$idx] + @($sibId) + $order[($idx+1)..($order.Count-1)] }
  $mp.block_order = $order
  $out = $json | ConvertTo-Json -Depth 100
  if($header){ $out = $header + "`r`n" + $out }
  Set-Content -Path $filePath -Value $out -Encoding UTF8
  return $true
}

$secPath = Join-Path $ThemeRepo $SectionRel
$tplPath = Join-Path $ThemeRepo $TemplateRel
$changed1 = FixMainProduct $secPath
$changed2 = ReorderTemplate $tplPath

if($changed1 -or $changed2){
  git -C $ThemeRepo add $SectionRel $TemplateRel 2>$null | Out-Null
  try { git -C $ThemeRepo pull --rebase | Out-Null } catch { }
  git -C $ThemeRepo commit -m "fix(pdp): single siblings_grid block, positioned after variant_selection; proper case-based render" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Normalization applied and pushed." -ForegroundColor Green
} else {
  Write-Host "No changes necessary." -ForegroundColor Yellow
}
