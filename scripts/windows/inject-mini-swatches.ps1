param(
  [string]$ThemeDir = 'C:\\Users\\Public\\xtra-theme-shopify',
  [string]$SnippetTag = "{% render 'collection-mini-swatches', product: product %}"
)

$ErrorActionPreference = 'Stop'

function Find-ProductCardFiles {
  param([string]$Dir)
  $patterns = @(
    'snippets/card-product.liquid',
    'snippets/product-card.liquid',
    'snippets/product-grid-item.liquid',
    'snippets/product-item.liquid',
    'sections/main-collection-product-grid.liquid'
  )
  $found = @()
  foreach($p in $patterns){
    $f = Join-Path $Dir $p
    if(Test-Path $f){ $found += $f }
  }
  # Fallback: scan snippets for common markers
  if(-not $found.Count){
    $cands = Get-ChildItem -Path (Join-Path $Dir 'snippets') -Filter '*.liquid' -Recurse -ErrorAction SilentlyContinue
    foreach($c in $cands){
      $txt = Get-Content -Raw -Path $c.FullName
      if($txt -match 'product(\.|\s).*image' -or $txt -match 'card__media' -or $txt -match 'media.*image'){
        $found += $c.FullName
      }
    }
  }
  return $found | Select-Object -Unique
}

function Inject-After-Image {
  param([string]$File,[string]$Snippet)
  $txt = Get-Content -Raw -Path $File
  if($txt -match [regex]::Escape($Snippet)){
    Write-Host "Already contains snippet: $File" -ForegroundColor Yellow
    return $false
  }
  # Heuristics: insert after common image/media block closing tag
  $markers = @(
    '</div><!-- image -->',
    '</div><!-- media -->',
    '</div>\s*{% end.* %}',
    '</div>\s*</a>',
    '</div>\s*</div>'
  )
  foreach($m in $markers){
    $rx = [regex]::new($m, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $mt = $rx.Match($txt)
    if($mt.Success){
      $idx = $mt.Index + $mt.Length
      $before = $txt.Substring(0,$idx)
      $after = $txt.Substring($idx)
      $new = $before + "`n  " + $Snippet + "`n" + $after
      Set-Content -Path $File -Value $new -Encoding UTF8
      Write-Host "Injected snippet into: $File" -ForegroundColor Green
      return $true
    }
  }
  # Fallback: append near end
  $new2 = $txt + "`n  " + $Snippet + "`n"
  Set-Content -Path $File -Value $new2 -Encoding UTF8
  Write-Host "Appended snippet at end: $File" -ForegroundColor Cyan
  return $true
}

# Main
if(-not (Test-Path $ThemeDir)){ throw "ThemeDir not found: $ThemeDir" }
$targets = Find-ProductCardFiles -Dir $ThemeDir
if(-not $targets.Count){ throw "No suitable product card liquid file found in $ThemeDir" }
$changed = $false
foreach($f in $targets){ $changed = (Inject-After-Image -File $f -Snippet $SnippetTag) -or $changed }

# Commit changes
$git = 'C:\\Program Files\\Git\\bin\\git.exe'
if(-not (Test-Path $git)){ $git = 'git' }
& $git -C $ThemeDir add -A
$status = (& $git -C $ThemeDir status --porcelain).Trim()
if($status){
  & $git -C $ThemeDir commit -m "feat(collection): add mini swatches below product image"
  & $git -C $ThemeDir push origin main
  Write-Host 'Committed and pushed theme changes.' -ForegroundColor Green
} else {
  Write-Host 'No changes to commit in theme repo.' -ForegroundColor Yellow
}
