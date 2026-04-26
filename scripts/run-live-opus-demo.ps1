$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. "$PSScriptRoot\load-env.ps1" -Path (Join-Path $root ".env.local")

if (-not $env:SURGEON_REASONER_PROVIDER) {
  $env:SURGEON_REASONER_PROVIDER = "anthropic"
}

if (-not $env:SURGEON_REASONER_MODEL) {
  $env:SURGEON_REASONER_MODEL = "claude-opus-4-7"
}

pnpm demo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
