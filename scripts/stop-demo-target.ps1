param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $root ".env.local")
$targetRoot = if ($env:SURGEON_TARGET_ROOT) { $env:SURGEON_TARGET_ROOT } else { Join-Path $root ".surgeon-targets" }
$repo = if ($env:SURGEON_TARGET_REPO) { $env:SURGEON_TARGET_REPO } else { Join-Path $targetRoot "cypress-realworld-app" }
$logDir = if ($env:SURGEON_TARGET_LOG_DIR) { $env:SURGEON_TARGET_LOG_DIR } else { Join-Path $targetRoot "logs" }
$pidFile = Join-Path $logDir "target-pids.json"
$processIds = [System.Collections.Generic.HashSet[int]]::new()

function Add-ProcessId {
  param([Nullable[int]]$Id)

  if ($null -ne $Id -and $Id -gt 0) {
    [void]$processIds.Add([int]$Id)
  }
}

if (Test-Path $pidFile) {
  try {
    $pidData = Get-Content -Raw $pidFile | ConvertFrom-Json
    Add-ProcessId $pidData.api
    Add-ProcessId $pidData.web
  }
  catch {
    if (-not $Quiet) {
      Write-Output "Ignoring unreadable PID file at $pidFile"
    }
  }
}

Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -gt 0 } |
  ForEach-Object { Add-ProcessId $_.OwningProcess }

Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and (
      $_.CommandLine -like "*$repo*" -or
      $_.CommandLine -like "*node_modules\vite\bin\vite.js*--host localhost*" -or
      $_.CommandLine -like "*ts-node*backend/app.ts*"
    )
  } |
  ForEach-Object { Add-ProcessId $_.ProcessId }

$stopped = 0
foreach ($processId in $processIds) {
  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    if ($process.ProcessName -eq "node") {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      $stopped += 1
    }
  }
  catch {
    # Already gone.
  }
}

if (Test-Path $pidFile) {
  Remove-Item $pidFile -Force
}

if (-not $Quiet) {
  Write-Output "Stopped $stopped demo target process(es)."
}
