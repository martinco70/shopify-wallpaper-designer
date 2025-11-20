param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$TemplateRel = 'templates/product.tapeten.json'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $TemplateRel
if(-not (Test-Path $file)) { throw "Template not found: $file" }
$raw = Get-Content -Raw -Path $file -Encoding UTF8
$cleanRaw = $raw -replace '(?s)^\s*/\*.*?\*/\s*', ''
$json = $cleanRaw | ConvertFrom-Json -ErrorAction Stop

if(-not $json.sections.'main-product') { throw "main-product section not found in $TemplateRel" }
$mp = $json.sections.'main-product'

$removedIds = @()
foreach($p in $mp.blocks.PSObject.Properties){
  $id = $p.Name; $blk = $p.Value
  if($blk.type -eq 'custom_liquid' -and $blk.settings -and $blk.settings.custom_liquid -like '*render*product-siblings-inline*'){
    $mp.blocks.PSObject.Properties.Remove($id) | Out-Null
    $removedIds += $id
  }
}
if($removedIds.Count -gt 0){
  $mp.block_order = @($mp.block_order | Where-Object { $removedIds -notcontains $_ })
  $out = $json | ConvertTo-Json -Depth 100
  if($raw -match '^(?s)\s*/\*.*?\*/'){ $out = ($raw -replace '(?s)(^\s*/\*.*?\*/).*','$1') + "`r`n" + $out }
  Set-Content -Path $file -Value $out -Encoding UTF8
  git -C $ThemeRepo add $TemplateRel | Out-Null
  try { git -C $ThemeRepo pull --rebase | Out-Null } catch { }
  git -C $ThemeRepo commit -m "chore(theme): remove temporary custom_liquid siblings render from product.tapeten.json" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host ("Removed temp blocks: {0}" -f ($removedIds -join ', ')) -ForegroundColor Green
} else {
  Write-Host "No temporary custom_liquid siblings block found." -ForegroundColor Yellow
}
