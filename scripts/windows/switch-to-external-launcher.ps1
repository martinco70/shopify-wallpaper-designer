param(
  [Parameter(Mandatory=$true)][string]$RepoUrl,
  [string]$Branch = 'main',
  [string]$TargetDir = 'C:\\Users\\Public\\xtra-theme-shopify',
  [string]$Version = 'AUTO',
  [switch]$UseParam
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

function Update-Theme-Loader {
  param([string]$RepoDir, [string]$Version, [bool]$UseParam)
  $layoutCandidates = @('layout/theme.liquid','layout/base.liquid')
  $externalUrl = if ($UseParam) { "https://app.wirzapp.ch/wpd-launcher.js?v=$Version" } else { "https://app.wirzapp.ch/wpd-launcher-$Version.js" }
  # Build tag with string concatenation to avoid PowerShell quoting issues
  $tag = '<script defer src="' + $externalUrl + '"></script>'

  foreach ($rel in $layoutCandidates) {
    $full = Join-Path $RepoDir $rel
    if (-not (Test-Path $full)) { continue }
    $txt = Get-Content -Raw -Path $full -Encoding UTF8

    # Remove existing asset loader lines referencing wpd-launcher.js via asset_url
    $txt = [regex]::Replace($txt, "(?is)<script[^>]+src=\\s*\\{\\{[^}]*wpd-launcher\\.js[^}]*\\}\\}[^>]*><\\/script>", "")
    # Remove any external or versioned launcher tags already present
    # Support both double and single quotes around src
    $patternExtLayoutD = '(?is)<script[^>]+src=\s*"[^"]*wpd-launcher[^"]*"[^>]*>\s*</script>'
    $patternExtLayoutS = "(?is)<script[^>]+src=\s*'[^']*wpd-launcher[^']*'[^>]*>\s*</script>"
    $txt = [regex]::Replace($txt, $patternExtLayoutD, "")
    $txt = [regex]::Replace($txt, $patternExtLayoutS, "")

    # Ensure we don't insert duplicates
    if ($txt -notmatch [regex]::Escape($externalUrl)) {
      # Insert before </head> if possible, otherwise at the end
      if ($txt -match "</head>") {
        $txt = $txt -replace "</head>", ($tag + "`n</head>")
      } else {
        $txt = $txt + "`n" + $tag + "`n"
      }
      Set-Content -Path $full -Value $txt -Encoding UTF8
      Write-Host "Injected external launcher into $rel" -ForegroundColor Green
    } else {
      Write-Host "External launcher already present in $rel" -ForegroundColor Yellow
    }
  }

  # Also sanitize snippet loader if present: ensure FORCE and prevent double-load
  $snippet = Join-Path (Join-Path $RepoDir 'snippets') 'wallpaper-designer.liquid'
  if (Test-Path $snippet) {
    $s = Get-Content -Raw -Path $snippet -Encoding UTF8
    # Remove any tag that injects {{ 'wpd-launcher.js' | asset_url }}
    $patternScript = '(?is)<script[^>]*>.*?wpd-launcher\.js.*?</script>'
    $s = [regex]::Replace($s, $patternScript, "")
    # Remove any direct external or versioned includes (e.g., wpd-launcher-2025xxxx-yy.js)
    $patternExternalD = '(?is)<script[^>]+src=\s*"[^"]*wpd-launcher[^"]*"[^>]*>\s*</script>'
    $patternExternalS = "(?is)<script[^>]+src=\s*'[^']*wpd-launcher[^']*'[^>]*>\s*</script>"
    $s = [regex]::Replace($s, $patternExternalD, "")
    $s = [regex]::Replace($s, $patternExternalS, "")
    # Add a tiny FORCE flag block once (safe no-op if script is already loaded)
    if ($s -notmatch "__WPD_LAUNCHER_FORCE__") {
      $force = "<script>(function(){try{window.__WPD_LAUNCHER_FORCE__=true}catch(e){}})();</script>"
      $s = $s + "`r`n" + $force + "`r`n"
      Write-Host "Added FORCE flag to snippet." -ForegroundColor Green
    }
    Set-Content -Path $snippet -Value $s -Encoding UTF8
  }

  # Global sanitation: remove legacy launcher tags/usages from all snippets/sections/templates (excluding layout files where we inject $tag)
  $paths = @('snippets','sections','templates') | ForEach-Object { Join-Path $RepoDir $_ }
  foreach ($root in $paths) {
    if (-not (Test-Path $root)) { continue }
    $files = Get-ChildItem -Path $root -Recurse -Include *.liquid -File -ErrorAction SilentlyContinue
    foreach ($f in $files) {
      try {
        $txt = Get-Content -Raw -Path $f.FullName -Encoding UTF8
        $orig = $txt
        # Remove <script src="...wpd-launcher*.js">...</script>
        $patternTagD = '(?is)<script[^>]+src=\s*"[^"]*wpd-launcher[^"]*"[^>]*>\s*</script>'
        $patternTagS = "(?is)<script[^>]+src=\s*'[^']*wpd-launcher[^']*'[^>]*>\s*</script>"
        $txt = [regex]::Replace($txt, $patternTagD, "")
        $txt = [regex]::Replace($txt, $patternTagS, "")
        # Remove inline builders that reference 'wpd-launcher' anywhere in the script body
        $patternInline = '(?is)<script[^>]*>[^<]*wpd-launcher[^<]*</script>'
        $txt = [regex]::Replace($txt, $patternInline, "")
        # Remove hardcoded wpd-launcher-btn class tokens to avoid unintended styling
        $txt = [regex]::Replace($txt, '\bwpd-launcher-btn\b', '')
        # Tidy double spaces inside class attributes
        $txt = [regex]::Replace($txt, '(?is)(class\s*=\s*"[^\"]*)\s{2,}([^"]*")', '$1 $2')
        $txt = [regex]::Replace($txt, "(?is)(class\s*=\s*'[^']*)\s{2,}([^']*')", '$1 $2')
        # Remove empty class attributes
        $txt = [regex]::Replace($txt, '(?is)\sclass\s*=\s*"\s*"', '')
        $txt = [regex]::Replace($txt, "(?is)\sclass\s*=\s*'\s*'", '')
        if ($txt -ne $orig) {
          Set-Content -Path $f.FullName -Value $txt -Encoding UTF8
          Write-Host ("Sanitized legacy launcher in {0}" -f $f.FullName.Replace($RepoDir + '\\','')) -ForegroundColor Cyan
        }
      } catch { Write-Warning ("Failed to sanitize {0}: {1}" -f $f.FullName, $_.Exception.Message) }
    }
  }
}

function Commit-And-Push {
  param([string]$RepoDir,[string]$Version)
  & $GIT -C $RepoDir add -A
  $status = (& $GIT -C $RepoDir status --porcelain).Trim()
  if ($status) {
    & $GIT -C $RepoDir commit -m ("chore(theme): use external wpd-launcher $Version from app.wirzapp.ch")
    & $GIT -C $RepoDir push origin $Branch
    Write-Host 'Pushed changes.' -ForegroundColor Green
  } else {
    Write-Host 'No changes to commit.' -ForegroundColor Yellow
  }
}

Ensure-Git
Clone-Or-Open -RepoUrl $RepoUrl -Branch $Branch -Dir $TargetDir
if ($Version -eq 'AUTO') {
  try {
    $launcherPath = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\..\backend\public\wpd-launcher.js') -ErrorAction Stop
    $content = Get-Content -Raw -Path $launcherPath -Encoding UTF8
    $m = [regex]::Match($content, "__WPD_LAUNCHER_VERSION__\s*=\s*'([0-9]{8}-[0-9]{2})'")
    if ($m.Success) { $Version = $m.Groups[1].Value; Write-Host "Detected launcher version: $Version" -ForegroundColor Cyan }
    else { Write-Warning 'Could not detect version from wpd-launcher.js; falling back to AUTO placeholder (no change).'; $Version = 'UNKNOWN' }
  } catch { Write-Warning "Version auto-detect failed: $($_.Exception.Message)"; $Version = 'UNKNOWN' }
}

Update-Theme-Loader -RepoDir $TargetDir -Version $Version -UseParam:$UseParam
Commit-And-Push -RepoDir $TargetDir -Version $Version
Write-Host ("Done: switched to external launcher $Version in $TargetDir") -ForegroundColor Green
