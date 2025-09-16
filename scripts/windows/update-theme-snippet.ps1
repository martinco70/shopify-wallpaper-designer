param(
  [Parameter(Mandatory=$true)][string]$ThemeDir,
  [string]$SnippetName = 'wallpaper-designer.liquid'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ThemeDir)) { throw "Theme directory not found: $ThemeDir" }
$snippet = Join-Path (Join-Path $ThemeDir 'snippets') $SnippetName
if (-not (Test-Path $snippet)) { throw "Snippet not found: $snippet" }

# Backup
$backup = "$snippet.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -Path $snippet -Destination $backup -Force
Write-Host ("Backup created: " + $backup) -ForegroundColor Yellow

$txt = Get-Content -Raw -Path $snippet -Encoding UTF8
$needsForce = ($txt -notmatch '__WPD_LAUNCHER_FORCE__')
$needsCb = ($txt -notmatch 'wpd-launcher\.js[^\n]*cb=')

if ($needsForce -or $needsCb) {
  $block = @'
<script>
(function(){
  try{ window.__WPD_LAUNCHER_FORCE__ = true; }catch(e){}
  if (window.__WPD_LAUNCHER_PRELOADED__ && !window.__WPD_LAUNCHER_FORCE__) return;
  window.__WPD_LAUNCHER_PRELOADED__ = true;
  var src = "{{ 'wpd-launcher.js' | asset_url }}";
  var sep = src.indexOf('?') === -1 ? '?' : '&';
  var cb = Math.floor(Date.now()/1000);
  var s = document.createElement('script');
  s.src = src + sep + 'cb=' + cb;
  s.async = true;
  var exists = Array.prototype.some.call(document.scripts, function(sc){ return sc.src && sc.src.indexOf('wpd-launcher.js') !== -1; });
  if (!exists) {
    (document.currentScript && document.currentScript.parentNode || document.head || document.body).appendChild(s);
  }
})();
</script>
'@

  Add-Content -Path $snippet -Value "`r`n" -Encoding UTF8
  Add-Content -Path $snippet -Value $block -Encoding UTF8
  Write-Host "Snippet updated with FORCE + cache-busting loader." -ForegroundColor Green
} else {
  Write-Host "Snippet already contains FORCE and cache-buster. Skipping changes." -ForegroundColor Green
}

Write-Host "Done." -ForegroundColor Green
