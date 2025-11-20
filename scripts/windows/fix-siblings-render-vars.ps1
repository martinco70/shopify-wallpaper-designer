param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$SectionRel = 'sections/main-product.liquid',
  [string]$SnippetRel = 'snippets/product-siblings-inline.liquid'
)

$ErrorActionPreference = 'Stop'
$sectionPath = Join-Path $ThemeRepo $SectionRel
$snippetPath = Join-Path $ThemeRepo $SnippetRel
if(-not (Test-Path $sectionPath)) { throw "Section not found: $sectionPath" }
if(-not (Test-Path $snippetPath)) { throw "Snippet not found: $snippetPath" }

# 1) Update render to pass block and section into snippet
$sec = Get-Content -Raw -Path $sectionPath -Encoding UTF8
$pattern = "\{\%\s*render\s+'product-siblings-inline'\s*\%\}"
$replacement = "{% render 'product-siblings-inline', block: block, section: section %}"
$secNew = [regex]::Replace($sec, $pattern, $replacement)
$secChanged = ($secNew -ne $sec)
if($secChanged){ Set-Content -Path $sectionPath -Value $secNew -Encoding UTF8 }

# 2) Make title render inside block context as well
$sn = Get-Content -Raw -Path $snippetPath -Encoding UTF8
# Change "if cfg_title != blank and block == blank" => "if cfg_title != blank"
$snNew = $sn -replace "\{\%\-\s*if\s+cfg_title\s*\!\=\s*blank\s+and\s+block\s*\=\=\s*blank\s*\-\%\}", "{%- if cfg_title != blank -%}"
$snChanged = ($snNew -ne $sn)
if($snChanged){ Set-Content -Path $snippetPath -Value $snNew -Encoding UTF8 }

if($secChanged -or $snChanged){
  git -C $ThemeRepo add $SectionRel $SnippetRel 2>$null | Out-Null
  try { git -C $ThemeRepo pull --rebase | Out-Null } catch {}
  git -C $ThemeRepo commit -m "fix(siblings-grid): pass block+section to snippet; enable title and settings from block context" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Applied fixes and pushed." -ForegroundColor Green
} else {
  Write-Host "No changes needed." -ForegroundColor Yellow
}
