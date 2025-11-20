param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify"
)
$ErrorActionPreference = 'Stop'

Write-Host ("Scanning: " + $ThemeDir) -ForegroundColor Yellow

# Helper to print matches uniformly
function Print-Matches {
  param(
    [Parameter(Mandatory=$true)] [object] $Matches,
    [Parameter(Mandatory=$true)] [string] $Root
  )
  if(-not $Matches){ return }
  $list = @($Matches)
  $list | ForEach-Object {
    $rel = $_.Path.Replace($Root+'\\','').Replace($Root+'/','')
    Write-Host ($rel+":"+ $_.LineNumber + ": " + ($_.Line.Trim()))
  }
}

# 1) CSS scan
Write-Host '== CSS matches ==' -ForegroundColor Cyan
$cssDir = Join-Path $ThemeDir 'assets'
if(Test-Path $cssDir){
  $cssFiles = Get-ChildItem -Path $cssDir -Recurse -File | Where-Object { $_.Extension -match '^\.(css|scss)$' }
  # Broadened patterns for hover/secondary-image logic and gates
  $cssPatterns = @(
    'second-img-hover','has-picture-picture','whatintent','async-hovers',
    ':has\(','supports-hover','prefers-reduced-motion','any-hover','pointer','no-touch',
    'card__media','media--hover','image--hover','hover-image','image--secondary','image--second','secondary-image',
    'product-card','product-item','wd-'
  )
  foreach($file in $cssFiles){
    foreach($pat in $cssPatterns){
      $m = Select-String -Path $file.FullName -Pattern $pat -SimpleMatch -ErrorAction SilentlyContinue
      if($m){ Print-Matches -Matches $m -Root $ThemeDir }
    }
  }
}

# 2) Liquid scan (snippets/sections/templates)
Write-Host '== Liquid matches ==' -ForegroundColor Cyan
$liquidDirs = @('snippets','sections','templates') | ForEach-Object { Join-Path $ThemeDir $_ }
foreach($ld in $liquidDirs){
  if(-not (Test-Path $ld)){ continue }
  $liquidFiles = Get-ChildItem -Path $ld -Recurse -File -Filter *.liquid -ErrorAction SilentlyContinue
  $liqPatterns = @(
    'second-img-hover','has-picture-picture','whatintent','async-hovers',
    'image.*hover','hover.*image','second.*image','secondary.*image','image.*second','image.*secondary',
    'product-card','product_item','product-item','card__media','media--hover','wd-'
  )
  foreach($file in $liquidFiles){
    foreach($pat in $liqPatterns){
      $m = Select-String -Path $file.FullName -Pattern $pat -SimpleMatch -ErrorAction SilentlyContinue
      if($m){ Print-Matches -Matches $m -Root $ThemeDir }
    }
  }
}

# 3) JS scan for gates that may disable hover
Write-Host '== JS matches ==' -ForegroundColor Cyan
$jsFiles = Get-ChildItem -Path $cssDir -Recurse -File | Where-Object { $_.Extension -match '^\.(js|ts)$' } -ErrorAction SilentlyContinue
if($jsFiles){
  $jsPatterns = @('whatintent','hover','pointer','any-hover','prefers-reduced-motion','data-whatintent')
  foreach($file in $jsFiles){
    foreach($pat in $jsPatterns){
      $m = Select-String -Path $file.FullName -Pattern $pat -SimpleMatch -ErrorAction SilentlyContinue
      if($m){ Print-Matches -Matches $m -Root $ThemeDir }
    }
  }
}
