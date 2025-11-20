param(
  [Parameter(Mandatory=$true)]
  [string]$FilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if(!(Test-Path -LiteralPath $FilePath)){ throw "File not found: $FilePath" }
$text = Get-Content -LiteralPath $FilePath -Raw

# 1) Remove stray naked line:   when 'variant_guard'   (without Liquid tags)
$text = ($text -split "`n") | ForEach-Object {
  if ($_ -match "^\s*when\s+'variant_guard'\s*$") { '' } else { $_ }
} | ForEach-Object { $_ } | Out-String

# 2) Find case block that contains variant_selection
$casePattern = '(?s)\{%-?\s*case\s+block\.type\s*-?%\}(.*?)\{%-?\s*endcase\s*-?%\}'
$m = [regex]::Matches($text, $casePattern)
if ($m.Count -eq 0) { throw 'No case block found in section' }

$idxToPatch = -1
for($i=0; $i -lt $m.Count; $i++){
  if ($m[$i].Groups[1].Value -match "when\s+'variant_selection'") { $idxToPatch = $i; break }
}
if ($idxToPatch -lt 0) { throw "No case block related to 'variant_selection' found" }

$caseMatch = $m[$idxToPatch]
$caseBody = $caseMatch.Groups[1].Value

# 3) If variant_guard liquid when is missing in this case, insert before endcase
if ($caseBody -notmatch "\{%-?\s*when\s+'variant_guard'\s*-?%\}") {
  $insertion = "`n                {%- when 'variant_guard' -%}`n                  {%- render 'variant-guard' -%}`n"
  $newCase = $caseBody + $insertion
  $text = $text.Substring(0, $caseMatch.Groups[1].Index) + $newCase + $text.Substring($caseMatch.Groups[1].Index + $caseBody.Length)
}

Set-Content -LiteralPath $FilePath -Encoding UTF8 -NoNewline -Value $text
Write-Output "Patched placement in: $FilePath"
