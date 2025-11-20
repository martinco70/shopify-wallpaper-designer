param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)
$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$lines = Get-Content -Path $file -Encoding UTF8
for($i=0;$i -lt $lines.Count;$i++){
  if($lines[$i] -match '\{\%\s*for\s+block\s+in\s+section\.blocks'){ Write-Host ("FOR at line {0}: {1}" -f ($i+1), $lines[$i]) }
  if($lines[$i] -match '\{\%\s*case\s+block\.type'){ Write-Host ("CASE at line {0}: {1}" -f ($i+1), $lines[$i]) }
  if($lines[$i] -match '\{\%\s*when\s+'){ Write-Host ("WHEN at line {0}: {1}" -f ($i+1), $lines[$i]) }
  if($lines[$i] -match '\{\%\s*endcase'){ Write-Host ("ENDCASE at line {0}: {1}" -f ($i+1), $lines[$i]) }
  if($lines[$i] -match '\{\%\s*endfor'){ Write-Host ("ENDFOR at line {0}: {1}" -f ($i+1), $lines[$i]) }
}
