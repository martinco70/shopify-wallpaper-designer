param(
  [string]$ThemeDir = 'C:\\Users\\Public\\xtra-theme-shopify'
)

$ErrorActionPreference = 'Stop'

function Find-CollectionFiles {
  param([string]$Dir)
  $patterns = @(
    'sections/main-collection-product-grid.liquid',
    'sections/main-collection.liquid',
    'sections/collection-template.liquid',
    'sections/collection.liquid',
    'templates/collection.liquid',
    'snippets/*.liquid'
  )
  $targets = @()
  foreach($p in $patterns){
    $glob = Join-Path $Dir $p
    $items = Get-ChildItem -Path $glob -ErrorAction SilentlyContinue
    foreach($it in $items){
      try{
        $txt = Get-Content -Raw -Path $it.FullName
        if($txt -match '(?m)\{%-?\s*for\s+product\s+in\s+collection\.products\s*-?%\}'){ $targets += $it.FullName }
      }catch{}
    }
  }
  return $targets | Select-Object -Unique
}

function Inject-Dedupe {
  param([string]$File)
  $txt = Get-Content -Raw -Path $File
  if($txt -match '_seen_groups' -and $txt -match 'contains\s+_needle'){ Write-Host "Already deduped: $File" -ForegroundColor Yellow; return $false }
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.AddRange([string[]](Get-Content -Path $File))
  $changed = $false

  # Ensure assign before the first for-loop
  $forIdx = -1
  for($i=0;$i -lt $lines.Count;$i++){
    if($lines[$i] -match '\{%-?\s*for\s+product\s+in\s+collection\.products\s*-?%\}') { $forIdx = $i; break }
  }
  if($forIdx -ge 0){
    # Insert assign if not present earlier in file
    $assignLine = '{% assign _seen_groups = "" %}'
    if(-not ($txt -match '(?m)\{%-?\s*assign\s+_seen_groups\s*=\s*""\s*-?%\}')){
      $lines.Insert($forIdx, $assignLine)
      $forIdx++
      $changed = $true
    }
    # Insert guard right after the for line
    $guard = @(
      '{% assign _group = product.metafields.custom.designname | default: "" | downcase %}',
      '{% if _group != "" %}',
      '  {% assign _needle = "|" | append: _group | append: "|" %}',
      '  {% if _seen_groups contains _needle %}{% continue %}{% endif %}',
      '  {% assign _seen_groups = _seen_groups | append: _needle %}',
      '{% endif %}'
    )
    # Only insert if a guard is not already present next lines
    $window = ($forIdx+1)..([Math]::Min($forIdx+6, $lines.Count-1))
    $hasGuard = $false
    foreach($k in $window){ if($lines[$k] -match '_needle' -or $lines[$k] -match '_seen_groups'){ $hasGuard = $true; break } }
    if(-not $hasGuard){
      for($g = $guard.Count - 1; $g -ge 0; $g--){ $lines.Insert($forIdx+1, $guard[$g]) }
      $changed = $true
    }
  }

  if($changed){ Set-Content -Path $File -Value ($lines -join "`n") -Encoding UTF8; Write-Host "Injected dedupe into: $File" -ForegroundColor Green }
  return $changed
}

if(-not (Test-Path $ThemeDir)){ throw "ThemeDir not found: $ThemeDir" }
$files = Find-CollectionFiles -Dir $ThemeDir
if(-not $files.Count){ throw "No collection files with product loops found in $ThemeDir" }
$any = $false
foreach($f in $files){ $any = (Inject-Dedupe -File $f) -or $any }

$git = 'C:\\Program Files\\Git\\bin\\git.exe'
if(-not (Test-Path $git)){ $git = 'git' }
& $git -C $ThemeDir add -A
$status = (& $git -C $ThemeDir status --porcelain).Trim()
if($status){
  & $git -C $ThemeDir commit -m "feat(collection): liquid-level dedupe per design group"
  & $git -C $ThemeDir push origin main
  Write-Host 'Committed and pushed theme changes.' -ForegroundColor Green
} else {
  Write-Host 'No changes to commit in theme repo.' -ForegroundColor Yellow
}
