param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [string]$ScreenRelPath = "assets/screen.css"
)

$ErrorActionPreference = 'Stop'

function Join-PathSafe($a,$b){
  return [System.IO.Path]::GetFullPath((Join-Path $a $b))
}

$screenPath = Join-PathSafe $ThemeDir $ScreenRelPath
if (!(Test-Path $screenPath)) {
  Write-Error "File not found: $screenPath"
  exit 1
}

$markerStart = "/* WPD HOVER OVERRIDE START */"
$markerEnd   = "/* WPD HOVER OVERRIDE END */"
$override = @"
$markerStart
/* Force crossfade primary->secondary image on hover regardless of legacy gates */
#root .product-card.second-img-hover.has-picture-picture figure { position:relative !important; }
#root .product-card.second-img-hover.has-picture-picture figure picture:first-of-type > img { position:relative !important; z-index:1 !important; display:block !important; opacity:1 !important; transition:opacity .18s ease !important; }
#root .product-card.second-img-hover.has-picture-picture figure picture:last-of-type > img { position:absolute !important; inset:0 !important; z-index:2 !important; display:block !important; opacity:0 !important; transition:opacity .18s ease !important; pointer-events:none !important; }
#root .product-card.second-img-hover.has-picture-picture:hover figure picture:last-of-type > img { opacity:1 !important; }
#root .product-card.second-img-hover.has-picture-picture:hover figure picture:first-of-type > img { opacity:0 !important; }
/* Fallback without <picture> wrappers */
#root .product-card.second-img-hover.has-picture-picture figure img:first-of-type { position:relative !important; z-index:1 !important; display:block !important; opacity:1 !important; transition:opacity .18s ease !important; }
#root .product-card.second-img-hover.has-picture-picture figure img+img { position:absolute !important; inset:0 !important; z-index:2 !important; display:block !important; opacity:0 !important; transition:opacity .18s ease !important; pointer-events:none !important; }
#root .product-card.second-img-hover.has-picture-picture:hover figure img+img { opacity:1 !important; }
#root .product-card.second-img-hover.has-picture-picture:hover figure img:first-of-type { opacity:0 !important; }
$markerEnd
"@

$content = Get-Content -LiteralPath $screenPath -Raw
if ($content -like "*${markerStart}*") {
  Write-Host "Already patched: $screenPath"
} else {
  Add-Content -LiteralPath $screenPath -Value "`r`n$override`r`n"
  Write-Host "Appended hover override to: $screenPath"

  Push-Location $ThemeDir
  try {
    git add -- "$ScreenRelPath" | Out-Null
    git commit -m "chore(theme): append WPD hover override to screen.css" | Out-Null
    git push | Out-Null
    Write-Host "Committed and pushed screen.css override."
  } finally {
    Pop-Location
  }
}
