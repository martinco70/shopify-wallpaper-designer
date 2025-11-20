param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify'
)

$ErrorActionPreference = 'Stop'
$tplDir = Join-Path $ThemeRepo 'templates'
Get-ChildItem -Path $tplDir -Filter 'product*.json' | ForEach-Object {
  $path = $_.FullName
  try {
    $raw = Get-Content -Raw -Path $path -Encoding UTF8
    $clean = $raw -replace '^(?s)\s*/\*.*?\*/\s*',''
    $json = $clean | ConvertFrom-Json
    $mp = $json.sections.'main-product'
    if(-not $mp){ return }
    $blocks = $mp.blocks
    $order = @($mp.block_order)
    # Find ids by type
    $sib = $null
    $var = $null
    foreach($p in $blocks.PSObject.Properties){
      $id = $p.Name; $blk = $p.Value
      if($blk.type -eq 'siblings_grid'){ $sib = $id }
      if(($blk.type -eq 'variant_selection') -or ($blk.type -eq 'variant_picker')){ $var = $id }
    }
    $sibIdx = if($sib){ [Array]::IndexOf($order, $sib) } else { -1 }
    $varIdx = if($var){ [Array]::IndexOf($order, $var) } else { -1 }
    Write-Host "Template: $(Split-Path -Leaf $path)"
    Write-Host "  variant block id: $var (idx=$varIdx)"
    Write-Host "  siblings block id: $sib (idx=$sibIdx)"
    Write-Host "  order count: $($order.Count)"
    Write-Host ""
  } catch {
    $msg = $_.Exception.Message
    Write-Host ("Error reading {0}: {1}" -f $path, $msg) -ForegroundColor Red
  }
}