param(
  [Parameter(Mandatory=$true)][string]$RepoUrl,
  [string]$Branch = 'main',
  [string]$TargetDir = 'C:\\Users\\Public\\xtra-theme-shopify',
  [string]$SyncMap = '',
  [switch]$SkipSnippet,
  [switch]$DryRun,
  [switch]$Force
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
  function Get-RepoSlug([string]$url){
    if([string]::IsNullOrWhiteSpace($url)){ return '' }
    $u = $url.Trim()
    # Normalize common ssh->https form first
    $u = $u -replace '^git@github\.com:', 'https://github.com/'
    # Drop trailing .git
    $u = $u -replace '\\.git$', ''
    # Extract owner/repo after github.com/
    if($u -match 'github\.com/([^/]+)/([^/]+)$'){
      return ($Matches[1] + '/' + $Matches[2])
    }
    # Fallback: try colon form github.com:owner/repo
    if($u -match 'github\.com:([^/]+)/(.*)$'){
      $part = $Matches[1] + '/' + $Matches[2]
      return ($part -replace '\\.git$', '')
    }
    return $u
  }
  if (Test-Path $Dir) {
    if (-not (Test-Path (Join-Path $Dir '.git'))) { throw "TargetDir exists but is not a git repo: $Dir" }
    $remote = (& $GIT -C $Dir remote get-url origin 2>$null)
    if (-not $remote) { throw 'Repo has no origin remote.' }
    $remoteSlug = Get-RepoSlug $remote
    $paramSlug = Get-RepoSlug $RepoUrl
    if ($remoteSlug -ne $paramSlug) { throw "Origin mismatch. Found: $remoteSlug Expected: $paramSlug" }
    # Normalize origin to provided URL (switch SSH->HTTPS to avoid interactive prompts)
    if ($remote -ne $RepoUrl) {
      & $GIT -C $Dir remote set-url origin $RepoUrl
    }
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
    if ($DryRun) {
      Write-Host ("[dry-run] would sync: " + $m.from + " -> " + $m.to) -ForegroundColor Yellow
      continue
    }
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
  # Write/update a sync marker to ensure a commit even if file diffs are identical
  try {
    $assetsDir = Join-Path $RepoDir 'assets'
    if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null }
    $marker = Join-Path $assetsDir 'wpd-sync-marker.txt'
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Set-Content -Path $marker -Value ("synced at " + $ts) -Encoding UTF8
  } catch {}
  # Cleanup invalid snippet backups that would break Shopify Git validation
  try {
    $snipDir = Join-Path $RepoDir 'snippets'
    if (Test-Path $snipDir) {
      Get-ChildItem -Path $snipDir -File -Recurse -Include '*.bak*' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ('Removing backup file from snippets: ' + $_.FullName) -ForegroundColor Yellow
        Remove-Item -Force -Path $_.FullName -ErrorAction SilentlyContinue
      }
    }
  } catch {}
  # Ensure non-interactive git settings
  try { & $GIT -C $RepoDir config commit.gpgsign false } catch {}
  $uname = (& $GIT -C $RepoDir config --get user.name 2>$null)
  if (-not $uname) { try { & $GIT -C $RepoDir config user.name 'wpd-deploy' } catch {} }
  $uemail = (& $GIT -C $RepoDir config --get user.email 2>$null)
  if (-not $uemail) { try { & $GIT -C $RepoDir config user.email 'deploy@example.com' } catch {} }
  & $GIT -C $RepoDir add -A
  $status = (& $GIT -C $RepoDir status --porcelain)
  if ($null -eq $status) { $status = '' }
  $status = $status.Trim()
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
# If dry-run: show pending changes and exit before commit/push
if ($DryRun) {
  try {
    & $GIT -C $TargetDir status --porcelain | Write-Host
  } catch {}
  Write-Host '[dry-run] Skipping commit and push.' -ForegroundColor Yellow
  return
}

# If there are changes and Force is not set, ask for confirmation
try {
  $pending = (& $GIT -C $TargetDir status --porcelain)
  if ($pending -and -not $Force) {
    Write-Host 'Pending changes to theme repo:' -ForegroundColor Yellow
    $pending | Write-Host
    $ans = Read-Host 'Proceed to commit and push? (y/N)'
    if ($ans -ne 'y') { Write-Host 'Aborted by user.' -ForegroundColor Yellow; return }
  }
} catch {}
if (-not $SkipSnippet) { Ensure-SnippetLoader -RepoDir $TargetDir }
Commit-And-Push -RepoDir $TargetDir
Write-Host ('Done syncing to ' + $RepoUrl + ' [' + $Branch + '] at ' + $TargetDir) -ForegroundColor Green
