param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string[]]$Templates = @('templates/product.json')
)

$ErrorActionPreference = 'Stop'

function EnsureBlockInTemplate([string]$filePath){
  if(-not (Test-Path $filePath)){
    Write-Warning "Template not found: $filePath"
    return $false
  }
  $raw = Get-Content -Raw -Path $filePath -Encoding UTF8
  # Strip leading /* ... */ comment blocks that Shopify sometimes adds
  $cleanRaw = $raw -replace '(?s)^\s*/\*.*?\*/\s*', ''
  try {
    $json = $cleanRaw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    $msg = $_.Exception.Message
    Write-Error ("Invalid JSON in {0}: {1}" -f $filePath, $msg)
    return $false
  }
  if(-not $json.sections.'main-product'){
    Write-Warning "'main-product' section not found in $filePath"
    return $false
  }
  $mp = $json.sections.'main-product'
  if(-not $mp.blocks){ $mp | Add-Member -NotePropertyName blocks -NotePropertyValue (@{}) }
  if(-not $mp.'block_order'){ $mp | Add-Member -NotePropertyName block_order -NotePropertyValue (@()) }

  # Detect existing block of type 'siblings_grid'
  $existingId = $null
  foreach($pair in $mp.blocks.PSObject.Properties){
    if($pair.Value.type -eq 'siblings_grid'){ $existingId = $pair.Name; break }
  }
  if(-not $existingId){
    $blockId = 'siblings-grid'
    if($mp.blocks.PSObject.Properties.Name -contains $blockId){
      $i = 1
      do { $blockId = "siblings-grid-$i"; $i++ } while ($mp.blocks.PSObject.Properties.Name -contains $blockId)
    }
    $blockObj = [ordered]@{
      type = 'siblings_grid'
      settings = [ordered]@{
        title = 'Weitere Farben'
        ns = 'custom'
        key = 'artikelgruppierung'
      }
    }
    $mp.blocks | Add-Member -NotePropertyName $blockId -NotePropertyValue $blockObj
    # Insert into block_order after variant_selection if present, else after price, else append
    $order = @($mp.block_order)
    $insertAfter = @('variant_selection','price','buy_button') | Where-Object { $order -contains $_ } | Select-Object -First 1
    if($insertAfter){
      $idx = [Array]::IndexOf($order, $insertAfter)
      if($idx -ge 0){ $order = $order[0..$idx] + @($blockId) + $order[($idx+1)..($order.Count-1)] }
      else { $order += $blockId }
    } else {
      $order += $blockId
    }
    $mp.block_order = $order
    $changed = $true
  } else {
    $changed = $false
  }

  if($changed){
    $out = $json | ConvertTo-Json -Depth 100
    # Re-prepend the header comment if it existed
    if($raw -match '^(?s)\s*/\*.*?\*/'){ $out = ($raw -replace '(?s)(^\s*/\*.*?\*/).*','$1') + "`r`n" + $out }
    Set-Content -Path $filePath -Value $out -Encoding UTF8
    Write-Host "Updated: $filePath" -ForegroundColor Green
    return $true
  } else {
    Write-Host "No change: $filePath (block already exists: $existingId)" -ForegroundColor Yellow
    return $false
  }
}

$any = $false
foreach($rel in $Templates){
  $path = Join-Path $ThemeRepo $rel
  if(EnsureBlockInTemplate $path){ $any = $true }
}

if($any){
  git -C $ThemeRepo add templates/*.json | Out-Null
  git -C $ThemeRepo commit -m "chore(theme): add siblings_grid block to product template(s) after variant picker" | Out-Null
  try { git -C $ThemeRepo pull --rebase | Out-Null } catch { }
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Templates updated and pushed." -ForegroundColor Green
} else {
  Write-Host "No template changes required." -ForegroundColor Yellow
}
