param(
  [switch]$KeepTargetRunning,
  [switch]$RestoreOriginal,
  [switch]$SkipTypecheck
)

$ErrorActionPreference = "Stop"

$arguments = @(
  "surgeon",
  "run",
  "--case",
  "cases/cypress-realworld-mobile-date-range-drawer.case.json"
)

if ($KeepTargetRunning) {
  $arguments += "--keep-target-running"
}

if ($RestoreOriginal) {
  $arguments += "--restore-original"
}

if ($SkipTypecheck) {
  $arguments += "--skip-typecheck"
}

& pnpm @arguments
if ($LASTEXITCODE -ne 0) {
  throw "pnpm $($arguments -join ' ') failed with exit code $LASTEXITCODE"
}
