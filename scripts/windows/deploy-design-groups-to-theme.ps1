param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify'
)

$ErrorActionPreference = 'Stop'
if(-not (Test-Path $ThemeRepo)) { throw "Theme repo not found at $ThemeRepo" }

$srcSection = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath 'theme-sections/product-siblings.liquid' | Resolve-Path
$srcSnippet = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath 'theme-snippets/design-sibling-card.liquid' | Resolve-Path
try { $srcInline  = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath 'theme-snippets/product-siblings-inline.liquid' | Resolve-Path } catch { $srcInline = $null }
try { $srcAsset = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath 'theme-assets/design-groups.json' | Resolve-Path } catch { $srcAsset = $null }

$dstSection = Join-Path $ThemeRepo 'sections/product-siblings.liquid'
$dstSnippet = Join-Path $ThemeRepo 'snippets/design-sibling-card.liquid'
$dstInline  = Join-Path $ThemeRepo 'snippets/product-siblings-inline.liquid'
$dstAsset   = Join-Path $ThemeRepo 'assets/design-groups.json'

Write-Host "Copying section…" -ForegroundColor Cyan
Copy-Item $srcSection $dstSection -Force
Write-Host "Copying snippet…" -ForegroundColor Cyan
Copy-Item $srcSnippet $dstSnippet -Force
if($srcInline){ Write-Host "Copying inline snippet…" -ForegroundColor Cyan; Copy-Item $srcInline $dstInline -Force }
if($srcAsset){ Write-Host "Copying asset…" -ForegroundColor Cyan; Copy-Item $srcAsset $dstAsset -Force }

Write-Host "Git commit/push…" -ForegroundColor Yellow
# Ensure remote uses HTTPS to avoid interactive SSH prompts
try { $remote = git -C $ThemeRepo remote get-url origin; if($remote -like 'git@github.com:*'){ $https = $remote -replace '^git@github.com:','https://github.com/'; git -C $ThemeRepo remote set-url origin $https } } catch {}
# Disable GPG signing and set identity if missing
try { git -C $ThemeRepo config commit.gpgsign false } catch {}
try { if(-not (git -C $ThemeRepo config --get user.name)){ git -C $ThemeRepo config user.name 'wpd-deploy' } } catch {}
try { if(-not (git -C $ThemeRepo config --get user.email)){ git -C $ThemeRepo config user.email 'deploy@example.com' } } catch {}
git -C $ThemeRepo add 'sections/product-siblings.liquid' 'snippets/design-sibling-card.liquid' 'snippets/product-siblings-inline.liquid' 'assets/design-groups.json'
git -C $ThemeRepo commit -m "feat(pdp): update product-siblings (build marker + fallback)"
git -C $ThemeRepo push origin main

Write-Host "Done." -ForegroundColor Green
