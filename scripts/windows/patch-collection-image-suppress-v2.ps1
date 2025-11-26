param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [string]$AssetFile = "assets/screen.css",
  [switch]$RemovePrevious
)
$ErrorActionPreference = 'Stop'

$cssPath = Join-Path $ThemeDir $AssetFile
if(!(Test-Path $cssPath)) { throw "Datei nicht gefunden: $cssPath" }

$oldMarkers = @(
  '/* WPD COLLECTION CARD IMG FIX START */','/* WPD COLLECTION CARD IMG FIX END */',
  '/* WPD COLLECTION CARD IMG LAYER START */','/* WPD COLLECTION CARD IMG LAYER END */'
)

$startMarker = '/* WPD COLLECTION IMG SUPPRESS V2 START */'
$endMarker   = '/* WPD COLLECTION IMG SUPPRESS V2 END */'

$block = @'
/* WPD COLLECTION IMG SUPPRESS V2 START */
/* Ziel: Alle sekundären Bilder auf Collection-Karten im Grid ausblenden.
   Robust gegen verschiedene Markup-Varianten (mehrere <a>, <picture>, <img>, Wrapper).
   Falls später Hover gewünscht: diesen Block entfernen und Layering-Block nutzen. */

/* Direkt unter card media: jedes picture/img nach dem ersten */
.template-collection .card__media > picture:not(:first-of-type),
.template-collection .card__media > img:not(:first-of-type),
.template-collection .product-card__media > picture:not(:first-of-type),
.template-collection .product-card__media > img:not(:first-of-type),
.template-collection .product-item__media > picture:not(:first-of-type),
.template-collection .product-item__media > img:not(:first-of-type) { display:none !important; }

/* Falls Bilder in mehreren <a>-Tags liegen: nur erstes <a> sichtbar */
.template-collection .card__media > a:nth-of-type(n+2),
.template-collection .product-card__media > a:nth-of-type(n+2),
.template-collection .product-item__media > a:nth-of-type(n+2) { display:none !important; }

/* Innerhalb des ersten <a>: zusätzliches picture/img nach dem ersten ausblenden */
.template-collection .card__media > a:first-of-type picture:not(:first-of-type),
.template-collection .card__media > a:first-of-type img:not(:first-of-type),
.template-collection .product-card__media > a:first-of-type picture:not(:first-of-type),
.template-collection .product-card__media > a:first-of-type img:not(:first-of-type),
.template-collection .product-item__media > a:first-of-type picture:not(:first-of-type),
.template-collection .product-item__media > a:first-of-type img:not(:first-of-type) { display:none !important; }

/* Debug (optional aktivierbar): Kontur für erstes Bild */
/*.template-collection .card__media > picture:first-of-type { outline:2px solid #3b82f6 }*/

/* WPD COLLECTION IMG SUPPRESS V2 END */
'@

$raw = Get-Content -LiteralPath $cssPath -Raw
if($RemovePrevious) {
  foreach($m in $oldMarkers){
    if($raw -match [regex]::Escape($m)){
      # Grob alles zwischen Start/End entfernen für bekannte Blöcke
      if($m -like '*START*'){
        $end = ($m -replace 'START','END')
        $pattern = [regex]::Escape($m) + '.+?' + [regex]::Escape($end)
        $raw = [regex]::Replace($raw,$pattern,'','Singleline')
      }
    }
  }
  Set-Content -LiteralPath $cssPath -Value $raw
  $raw = Get-Content -LiteralPath $cssPath -Raw
  Write-Host 'Vorherige Bild-Fix-Blöcke entfernt.' -ForegroundColor Yellow
}

if($raw -match [regex]::Escape($startMarker)){
  Write-Host 'V2 Block schon vorhanden – keine Änderung.' -ForegroundColor Yellow
} else {
  Add-Content -LiteralPath $cssPath -Value "`r`n$block`r`n"
  Write-Host 'V2 Block angehängt.' -ForegroundColor Green
  try {
    Push-Location $ThemeDir
    if((git rev-parse --is-inside-work-tree) -eq 'true'){
      git add -- $AssetFile | Out-Null
      git commit -m 'WPD: Collection image suppress V2 (robust selectors)' | Out-Null
      Write-Host 'Commit erstellt.' -ForegroundColor Green
    }
  } catch {}
  finally { Pop-Location }
}
