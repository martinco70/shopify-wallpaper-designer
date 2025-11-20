Param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [switch]$DryRun,
  [switch]$Verbose
)

$ErrorActionPreference = 'Stop'

function Log($msg){ Write-Host ("[patch] " + $msg) }
function V($msg){ if($Verbose){ Write-Host ("[patch:debug] " + $msg) } }

if(-not (Test-Path $ThemeDir)){
  throw ("ThemeDir not found: " + $ThemeDir)
}

# Candidate files (snippets + sections) that could host product card markup in Xtra theme
$candidateRel = @(
  'snippets/card-product.liquid',
  'snippets/product-card.liquid',
  'snippets/product-grid-item.liquid',
  'snippets/product-item.liquid',
  'sections/related-products.liquid',
  'sections/featured-collection.liquid'
)
$candidates = @()
foreach($rel in $candidateRel){ $candidates += (Join-Path $ThemeDir $rel) }

$existing = @()
foreach($c in $candidates){ if(Test-Path $c){ $existing += $c } }
if($existing.Count -eq 0){
  throw 'No candidate product card files found - extend list in script if theme uses a different filename.'
}

$renderPattern = '\{%\s*render\s+[''\"]wpd-price-per-unit[''\"]'
$infoMarkers = @('card__information', 'product-card__info', 'card-information', 'product-content', 'card__content', 'card__details')
$imageMarkers = @('card__inner', 'card__media', 'product-card__image', 'product-image', 'media--hover')

$injectedCount = 0
$relocatedCount = 0
$skippedCount = 0
$backupStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')

foreach($file in $existing){
  $text = Get-Content -Raw -LiteralPath $file
  $orig = $text
  $hasRender = [regex]::IsMatch($text, $renderPattern)

  # Heuristics: determine if render currently sits inside image area (before closing of wrapper that contains image markers)
  $needsRelocate = $false
  if($hasRender){
    # find position of render
    $renderIdx = $text.IndexOf('{% render ')
    if($renderIdx -ge 0){
      # look backwards for image marker before a typical info marker
      $before = $text.Substring(0, $renderIdx)
      $imageHit = $false
      foreach($mk in $imageMarkers){ if($before -match [regex]::Escape($mk)){ $imageHit = $true; break } }
      $infoHit = $false
      foreach($mk in $infoMarkers){ if($before -match [regex]::Escape($mk)){ $infoHit = $true; break } }
      if($imageHit -and (-not $infoHit)){
        $needsRelocate = $true
      }
    }
  }

  if($hasRender -and -not $needsRelocate){
    Log ("OK (already in info area): " + $file)
    $skippedCount++
    continue
  }

  # Remove any existing occurrences first (avoid duplicates)
  if($hasRender){
    V ("Removing existing render from " + $file)
    $text = [regex]::Replace($text, $renderPattern + '.*?%}', '', 'Singleline')
  }

  # Find insertion anchor: after price or within info wrapper
  $anchorIdx = -1
  $anchorRegexes = @(
    '\{%\s*render\s+[''\"]price',
    'class="price',
    'class="product-price',
    'data-product-price'
  )
  foreach($r in $anchorRegexes){
    $m = [regex]::Match($text, $r)
    if($m.Success){ $anchorIdx = $m.Index + $m.Length; break }
  }
  if($anchorIdx -eq -1){
    # fallback: insert before closing of info wrapper
    foreach($marker in $infoMarkers){
      $mInfo = [regex]::Match($text, [regex]::Escape($marker))
      if($mInfo.Success){
        # find next closing div after marker
        $after = $text.Substring($mInfo.Index)
        $closeIdx = $after.IndexOf('</div>')
        if($closeIdx -ge 0){
          $anchorIdx = $mInfo.Index + $closeIdx
          break
        }
      }
    }
  }

  if($anchorIdx -eq -1){
    Log ("WARN: Could not find suitable anchor in " + $file + " - skipping")
    $skippedCount++
    continue
  }

  $insertion = "`n{% render 'wpd-price-per-unit', product: card_product, variant: card_product.selected_or_first_available_variant %}`n"

  # If card_product not available in context, attempt 'product'
  if(-not ($text -match 'card_product')){
    $insertion = "`n{% render 'wpd-price-per-unit', product: product, variant: product.selected_or_first_available_variant %}`n"
  }

  $text = $text.Substring(0, $anchorIdx) + $insertion + $text.Substring($anchorIdx)

  if($DryRun){
    Log ("DRY-RUN would patch: " + $file)
    continue
  }

  # Backup
  $bak = $file + '.' + $backupStamp + '.bak'
  Set-Content -LiteralPath $bak -Value $orig -Encoding UTF8
  Set-Content -LiteralPath $file -Value $text -Encoding UTF8
  Log ("Patched: " + $file + " (backup: " + (Split-Path -Leaf $bak) + ")")
  if($hasRender){ $relocatedCount++ } else { $injectedCount++ }
}

Log ("Summary: injected=" + $injectedCount + " relocated=" + $relocatedCount + " skipped=" + $skippedCount)
if($DryRun){ Log 'Dry-run complete. Re-run without -DryRun to apply.' }
