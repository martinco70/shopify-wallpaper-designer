Param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if(!(Test-Path $ThemeDir)){ throw "ThemeDir not found: $ThemeDir" }

# Files that typically render product cards / collection items
$candidateRel = @(
  'snippets/card-product.liquid',
  'snippets/product-card.liquid',
  'snippets/product-grid-item.liquid',
  'snippets/product-item.liquid',
  'snippets/product-tile.liquid',
  'sections/related-products.liquid',
  'sections/featured-collection.liquid',
  'sections/main-collection-product-grid.liquid',
  'sections/main-collection.liquid',
  'snippets/collection-product-card.liquid'
)

# Resolve existing candidates and also search broadly for matches in snippets/ and sections/
$files = New-Object System.Collections.Generic.List[string]
foreach($rel in $candidateRel){ $p = Join-Path $ThemeDir $rel; if(Test-Path $p){ $files.Add($p) } }

# Broad search: any .liquid under snippets/ or sections/ that contains our render/include
Get-ChildItem -Path (Join-Path $ThemeDir 'snippets') -Recurse -Filter *.liquid -ErrorAction SilentlyContinue | ForEach-Object {
  $t = Get-Content -LiteralPath $_.FullName -Raw
  if($t -match "wpd-price-per-unit"){ $files.Add($_.FullName) }
}
Get-ChildItem -Path (Join-Path $ThemeDir 'sections') -Recurse -Filter *.liquid -ErrorAction SilentlyContinue | ForEach-Object {
  $t = Get-Content -LiteralPath $_.FullName -Raw
  if($t -match "wpd-price-per-unit"){ $files.Add($_.FullName) }
}

# De-duplicate
$files = $files | Sort-Object -Unique

# Regex for render/include of the snippet
$renderRe = [regex]'\{%\s*(render|include)\s+(["\''])wpd-price-per-unit\2[^%]*%\}'

$patched = @()
foreach($file in $files){
  # Skip PDP-specific files by name (keep PDP behavior intact)
  $relPath = ($file.Substring($ThemeDir.Length) -replace '^[\\/]+','')
  if($relPath -match '^sections/(main-)?product' -or $relPath -match '^templates/product'){
    continue
  }
  $text = Get-Content -LiteralPath $file -Raw
  if($renderRe.IsMatch($text)){
    $new = $renderRe.Replace($text, '')
    if($new -ne $text){
      if($DryRun){ Write-Host "DRY: would clean $relPath" }
      else {
        Set-Content -LiteralPath $file -Value $new -Encoding UTF8
        $patched += $relPath
      }
    }
  }
}

if(-not $DryRun -and $patched.Count -gt 0){
  Push-Location $ThemeDir
  try{
    git add --all | Out-Null
    git commit -m ("chore(theme): remove price-per-unit from collection/card snippets (`"" + ($patched -join ', ') + "`"") | Out-Null
    git push | Out-Null
    Write-Host ("Patched and pushed: " + ($patched.Count) + " file(s)")
  } finally { Pop-Location }
} else {
  Write-Host "No files changed (either none found or DryRun)."
}
