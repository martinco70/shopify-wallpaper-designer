param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$lines = Get-Content -Path $file -Encoding UTF8
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match 'product-siblings-inline'){
    $start = [Math]::Max(0, $i-5)
    $end = [Math]::Min($lines.Count-1, $i+5)
    Write-Host "----- Context lines $start..$end -----" -ForegroundColor Cyan
    for($j=$start; $j -le $end; $j++){
      $ln = ($j+1).ToString().PadLeft(4,' ')
      Write-Output ("{0}: {1}" -f $ln, $lines[$j])
    }
  }
}