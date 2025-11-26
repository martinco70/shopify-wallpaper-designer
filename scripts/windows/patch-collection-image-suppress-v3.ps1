param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [string]$AssetFile = "assets/screen.css"
)
$ErrorActionPreference = 'Stop'

$cssPath = Join-Path $ThemeDir $AssetFile
if(!(Test-Path $cssPath)) { throw "Datei nicht gefunden: $cssPath" }

$start = '/* WPD COLLECTION IMG SUPPRESS V3 START */'
$end   = '/* WPD COLLECTION IMG SUPPRESS V3 END */'

$block = @'
/* WPD COLLECTION IMG SUPPRESS V3 START */
/* Zielgerichtet für Markup: li.product-card.has-picture-picture > figure ... */
.template-collection .product-card.has-picture-picture figure > a:nth-of-type(n+2) { display:none !important; }
.template-collection .product-card.has-picture-picture figure > a:first-of-type picture:not(:first-of-type),
.template-collection .product-card.has-picture-picture figure > a:first-of-type img:not(:first-of-type) { display:none !important; }
.template-collection .product-card.has-picture-picture figure > picture:nth-of-type(n+2),
.template-collection .product-card.has-picture-picture figure > img:nth-of-type(n+2) { display:none !important; }
/* WPD COLLECTION IMG SUPPRESS V3 END */
'@

$raw = Get-Content -LiteralPath $cssPath -Raw
if($raw -match [regex]::Escape($start)){
  Write-Host 'V3-Block bereits vorhanden.' -ForegroundColor Yellow
} else {
  Add-Content -LiteralPath $cssPath -Value "`r`n$block`r`n"
  Write-Host 'V3-Block angehängt.' -ForegroundColor Green
  try {
    Push-Location $ThemeDir
    if((git rev-parse --is-inside-work-tree) -eq 'true'){
      git add -- $AssetFile | Out-Null
      git commit -m 'WPD: Collection image suppress V3 (product-card figure targeting)' | Out-Null
      Write-Host 'Commit erstellt.' -ForegroundColor Green
    }
  } catch {}
  finally { Pop-Location }
}
