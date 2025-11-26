param(
  [string]$ThemeDir = "C:/Users/Public/xtra-theme-shopify",
  [string]$SectionFile = "sections/main-collection.liquid"
)
$ErrorActionPreference = 'Stop'

$path = Join-Path $ThemeDir $SectionFile
if(!(Test-Path $path)){ throw "Datei nicht gefunden: $path" }

$start = "{% comment %} WPD INLINE IMG HIDE START {% endcomment %}"
$end   = "{% comment %} WPD INLINE IMG HIDE END {% endcomment %}"

$css = @'
<style id="wpd-inline-img-hide">
.template-collection li.product-card.has-picture-picture figure > a:nth-of-type(n+2),
.template-collection li.product-card.has-picture-picture figure > a > picture:nth-of-type(n+2),
.template-collection li.product-card.has-picture-picture figure > a > img:nth-of-type(n+2),
.template-collection li.product-card.has-picture-picture figure > a:first-of-type picture:not(:first-of-type),
.template-collection li.product-card.has-picture-picture figure > a:first-of-type img:not(:first-of-type) {
  display:none !important;
}
</style>
'@

$raw = Get-Content -LiteralPath $path -Raw
if($raw -match [regex]::Escape($start)){
  Write-Host 'Inline Block existiert bereits.' -ForegroundColor Yellow
} else {
  # Füge direkt nach erstem <div oder am Anfang ein
  $insertIndex = $raw.IndexOf('<')
  if($insertIndex -lt 0){ $insertIndex = 0 }
  $before = $raw.Substring(0,$insertIndex)
  $after  = $raw.Substring($insertIndex)
  $new = $before + "\n" + $start + "\n" + $css + "\n" + $end + "\n" + $after
  Set-Content -LiteralPath $path -Value $new
  Write-Host 'Inline Bild-Unterdrückung injiziert.' -ForegroundColor Green
  try {
    Push-Location $ThemeDir
    if((git rev-parse --is-inside-work-tree) -eq 'true'){
      git add -- $SectionFile | Out-Null
      git commit -m 'WPD: inline image hide block in main-collection.liquid' | Out-Null
      Write-Host 'Commit erstellt.' -ForegroundColor Green
    }
  } catch {}
  finally { Pop-Location }
}
