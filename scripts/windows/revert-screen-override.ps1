param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [string]$ScreenRelPath = "assets/screen.css"
)

$ErrorActionPreference = 'Stop'

function Join-PathSafe($a,$b){ [System.IO.Path]::GetFullPath((Join-Path $a $b)) }

$screenPath = Join-PathSafe $ThemeDir $ScreenRelPath
if (!(Test-Path $screenPath)) { Write-Error "File not found: $screenPath"; exit 1 }

$markerStart = "/* WPD HOVER OVERRIDE START */"
$markerEnd   = "/* WPD HOVER OVERRIDE END */"

$content = Get-Content -LiteralPath $screenPath -Raw
if ($content -like "*${markerStart}*") {
  $pattern = [regex]::Escape($markerStart) + ".*?" + [regex]::Escape($markerEnd)
  $new = [regex]::Replace($content, $pattern, "", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  Set-Content -LiteralPath $screenPath -Value $new -Encoding UTF8
  Push-Location $ThemeDir
  try {
    git add -- "$ScreenRelPath" | Out-Null
    git commit -m "chore(theme): remove WPD hover override block from screen.css" | Out-Null
    git push | Out-Null
    Write-Host "Removed override block and pushed."
  } finally { Pop-Location }
} else {
  Write-Host "No override block found; nothing to remove."
}
