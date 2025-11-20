param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [string]$AssetFile = "assets/screen.css",
  [switch]$RemoveHideBlock
)
$ErrorActionPreference = 'Stop'

$cssPath = Join-Path $ThemeDir $AssetFile
if(!(Test-Path $cssPath)) { throw "Datei nicht gefunden: $cssPath" }

$hideStart = '/* WPD COLLECTION CARD IMG FIX START */'
$hideEnd   = '/* WPD COLLECTION CARD IMG FIX END */'
$layerStart = '/* WPD COLLECTION CARD IMG LAYER START */'
$layerEnd   = '/* WPD COLLECTION CARD IMG LAYER END */'

# Layering Block: Überlagert zweites Bild statt Stapeln
$layerBlock = @'
/* WPD COLLECTION CARD IMG LAYER START */
/* Sauberes Layering anstatt display:none – ermöglicht später einfachen Hover-Fade */
.template-collection .card__media,
.template-collection .product-card__media,
.template-collection .product-item__media { position:relative; }

.template-collection .card__media picture:nth-of-type(2),
.template-collection .card__media img:nth-of-type(2),
.template-collection .product-card__media picture:nth-of-type(2),
.template-collection .product-card__media img:nth-of-type(2),
.template-collection .product-item__media picture:nth-of-type(2),
.template-collection .product-item__media img:nth-of-type(2) {
  position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
  opacity:0; pointer-events:none; transition:opacity .25s ease;
}

/* Optional: nur aktivieren, wenn Hover gewünscht – auskommentiert lassen falls nicht gebraucht
.template-collection .card__media:hover picture:nth-of-type(2),
.template-collection .card__media:hover img:nth-of-type(2),
.template-collection .product-card__media:hover picture:nth-of-type(2),
.template-collection .product-card__media:hover img:nth-of-type(2),
.template-collection .product-item__media:hover picture:nth-of-type(2),
.template-collection .product-item__media:hover img:nth-of-type(2) {
  opacity:1;
}
*/
/* WPD COLLECTION CARD IMG LAYER END */
'@

$raw = Get-Content -LiteralPath $cssPath -Raw

if($RemoveHideBlock) {
  if($raw -match [regex]::Escape($hideStart)) {
    $pattern = [regex]::Escape($hideStart) + '.+?' + [regex]::Escape($hideEnd)
    $raw = [regex]::Replace($raw,$pattern,'','Singleline')
    Write-Host 'Alter Hide-Block entfernt.' -ForegroundColor Yellow
  } else {
    Write-Host 'Kein Hide-Block gefunden.' -ForegroundColor DarkYellow
  }
}

if($raw -match [regex]::Escape($layerStart)) {
  Write-Host 'Layer-Block bereits vorhanden – keine Aktion.' -ForegroundColor Yellow
} else {
  Add-Content -LiteralPath $cssPath -Value "`r`n$layerBlock`r`n"
  Write-Host 'Layer-Block angehängt.' -ForegroundColor Green
  try {
    Push-Location $ThemeDir
    if((git rev-parse --is-inside-work-tree) -eq 'true') {
      git add -- $AssetFile | Out-Null
      git commit -m 'WPD: Layering für Collection Karten (zweites Bild überlagert)' | Out-Null
      Write-Host 'Commit erstellt.' -ForegroundColor Green
    }
  } catch {}
  finally { Pop-Location }
}
