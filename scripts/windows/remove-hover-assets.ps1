param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify"
)
$ErrorActionPreference = 'Stop'
$assets = @(
  "assets/wpd-hover.css",
  "assets/wpd-hover-override.css",
  "assets/wpd-hover-init.js"
)
foreach($rel in $assets){
  $p = Join-Path $ThemeDir $rel
  if(Test-Path $p){ Remove-Item -LiteralPath $p -Force; Write-Host "Deleted $rel" }
}
Push-Location $ThemeDir
try {
  git add -A | Out-Null
  git commit -m "chore(theme): remove hover assets and cleanup" | Out-Null
  git push | Out-Null
  Write-Host "Committed removal of hover assets."
} finally { Pop-Location }
