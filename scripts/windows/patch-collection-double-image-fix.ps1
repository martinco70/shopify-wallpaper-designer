param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [string]$AssetFile = "assets/screen.css"
)
$ErrorActionPreference = 'Stop'

$cssPath = Join-Path $ThemeDir $AssetFile
if(!(Test-Path $cssPath)){
  Write-Error "File not found: $cssPath"
}

$startMarker = "/* WPD COLLECTION CARD IMG FIX START */"
$endMarker   = "/* WPD COLLECTION CARD IMG FIX END */"

$block = @'
/* WPD COLLECTION CARD IMG FIX START */
/* Hide secondary images on collection product cards to avoid stacked layout */
.template-collection .card__media img:nth-of-type(n+2),
.template-collection .card__media picture:nth-of-type(n+2),
.template-collection .product-card__media img:nth-of-type(n+2),
.template-collection .product-card__media picture:nth-of-type(n+2),
.template-collection .product-item__media img:nth-of-type(n+2),
.template-collection .product-item__media picture:nth-of-type(n+2) {
  display: none !important;
}
/* WPD COLLECTION CARD IMG FIX END */
'@

$content = Get-Content -LiteralPath $cssPath -Raw
if($content -notmatch [regex]::Escape($startMarker)){
  Add-Content -LiteralPath $cssPath -Value "`r`n$block`r`n"
  Write-Host "Patch appended to $AssetFile" -ForegroundColor Green
} else {
  Write-Host "Patch already present in $AssetFile; skipping" -ForegroundColor Yellow
}

# Try to commit if in a git repo
try{
  Push-Location $ThemeDir
  if((git rev-parse --is-inside-work-tree) -eq 'true'){
    git add -- "$AssetFile" | Out-Null
    git commit -m "WPD: hide secondary images on collection cards (temporary fix)" | Out-Null
    Write-Host "Committed CSS fix in theme repo." -ForegroundColor Green
  }
} catch {}
finally{ Pop-Location }
