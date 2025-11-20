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

$content = Get-Content -LiteralPath $cssPath -Raw

if($content -match [regex]::Escape($startMarker)){
  $pattern = [regex]::Escape($startMarker) + ".*?" + [regex]::Escape($endMarker)
  $new = [regex]::Replace($content, $pattern, '', 'Singleline')
  Set-Content -LiteralPath $cssPath -Value $new
  Write-Host "Reverted collection image fix in $AssetFile" -ForegroundColor Green
  try{
    Push-Location $ThemeDir
    if((git rev-parse --is-inside-work-tree) -eq 'true'){
      git add -- "$AssetFile" | Out-Null
      git commit -m "WPD: revert collection card image fix" | Out-Null
      Write-Host "Committed revert in theme repo." -ForegroundColor Green
    }
  } catch {}
  finally{ Pop-Location }
} else {
  Write-Host "No fix block found; nothing to revert." -ForegroundColor Yellow
}
