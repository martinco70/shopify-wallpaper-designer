param([Parameter(Mandatory=$true)][string]$ZipPath)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$here\.."
if (!(Test-Path $ZipPath)) { throw "File not found: $ZipPath" }
Expand-Archive -Path $ZipPath -DestinationPath . -Force
Write-Host "Restored from: $ZipPath"
