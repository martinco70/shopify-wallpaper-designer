param(
  [Parameter(Mandatory=$true)][string]$RepoUrl,
  [string]$Branch = 'main',
  [string]$TargetDir = 'C:\\Users\\Public\\xtra-theme-shopify',
  [string]$SyncMap = '',
  [switch]$SkipSnippet
)

$ErrorActionPreference = 'Stop'

function Ensure-Git {
  $global:GIT = 'C:\\Program Files\\Git\\bin\\git.exe'
  if (-not (Test-Path $GIT)) { $global:GIT = 'git' }
  $v = & $GIT --version 2>$null
  if (-not $v) { throw 'Git is not installed or not on PATH.' }
}

function Clone-Or-Open {
  param([string]$RepoUrl,[string]$Branch,[string]$Dir)
  if (Test-Path $Dir) {
    if (-not (Test-Path (Join-Path $Dir '.git'))) { throw "TargetDir exists but is not a git repo: $Dir" }
    $remote = (& $GIT -C $Dir remote get-url origin 2>$null)
    if (-not $remote) { throw 'Repo has no origin remote.' }
    if ($remote -ne $RepoUrl) { throw "Origin mismatch. Found: $remote Expected: $RepoUrl" }
    & $GIT -C $Dir fetch --all --prune
    & $GIT -C $Dir checkout $Branch
    & $GIT -C $Dir pull --ff-only origin $Branch
  } else {
    & $GIT clone --branch $Branch --single-branch $RepoUrl $Dir
  }
}

function Update-Launcher {
  param([string]$RepoDir)
  $src = Join-Path $PSScriptRoot '..\\..\\backend\\public\\wpd-launcher.js' | Resolve-Path
  $dst = Join-Path $RepoDir 'assets\\wpd-launcher.js'
  if (-not (Test-Path (Split-Path $dst -Parent))) { New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null }
  Copy-Item -Force -Path $src -Destination $dst
  $content = Get-Content -Raw -Path $dst
  if ($content -match "__WPD_LAUNCHER_VERSION__\s*=\s*'([0-9-]+)'") {
    Write-Host ('Launcher version in asset: ' + $matches[1]) -ForegroundColor Cyan
  }
}

function Apply-SyncMap {
  param([string]$RepoDir, [string]$MapPath)
  if (-not $MapPath) { return }
  $mapFull = Resolve-Path $MapPath
  if (-not (Test-Path $mapFull)) { throw "Sync map not found: $MapPath" }
  $json = Get-Content -Raw -Path $mapFull | ConvertFrom-Json
  foreach ($m in $json) {
    $src = Resolve-Path (Join-Path $PSScriptRoot (Join-Path '..\\..' $m.from))
    $dst = Join-Path $RepoDir $m.to
    $dstDir = Split-Path $dst -Parent
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
    Copy-Item -Force -Path $src -Destination $dst
    Write-Host ("Synced: " + $m.from + " -> " + $m.to) -ForegroundColor Cyan
  }
}

function Ensure-SnippetLoader {
  param([string]$RepoDir)
  $snippet = Join-Path (Join-Path $RepoDir 'snippets') 'wallpaper-designer.liquid'
  if (-not (Test-Path $snippet)) { Write-Warning "Snippet not found: $snippet"; return }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update-theme-snippet.ps1') -ThemeDir $RepoDir | Write-Host
}

function Commit-And-Push {
  param([string]$RepoDir)
  & $GIT -C $RepoDir add -A
  $status = (& $GIT -C $RepoDir status --porcelain).Trim()
  if ($status) {
    $ver = 'unknown'
    $asset = Join-Path $RepoDir 'assets\\wpd-launcher.js'
    if (Test-Path $asset) {
      $txt = Get-Content -Raw $asset
      if ($txt -match "__WPD_LAUNCHER_VERSION__\s*=\s*'([0-9-]+)'") { $ver = $matches[1] }
    }
    & $GIT -C $RepoDir commit -m ("chore(theme): update wpd-launcher to " + $ver)
    & $GIT -C $RepoDir push origin $Branch
    Write-Host 'Pushed changes.' -ForegroundColor Green
  } else {
    Write-Host 'No changes to commit.' -ForegroundColor Yellow
  }
}

# Main
Ensure-Git
Clone-Or-Open -RepoUrl $RepoUrl -Branch $Branch -Dir $TargetDir
if ($SyncMap) {
  Apply-SyncMap -RepoDir $TargetDir -MapPath $SyncMap
} else {
  Update-Launcher -RepoDir $TargetDir
}
if (-not $SkipSnippet) { Ensure-SnippetLoader -RepoDir $TargetDir }
Commit-And-Push -RepoDir $TargetDir
Write-Host ('Done syncing to ' + $RepoUrl + ' [' + $Branch + '] at ' + $TargetDir) -ForegroundColor Green
