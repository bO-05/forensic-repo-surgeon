$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $root ".env.local")
$nodeDir = Join-Path $root "tools\node-v22.12.0-win-x64"
$targetRoot = if ($env:SURGEON_TARGET_ROOT) { $env:SURGEON_TARGET_ROOT } else { Join-Path $root ".surgeon-targets" }
$repo = if ($env:SURGEON_TARGET_REPO) { $env:SURGEON_TARGET_REPO } else { Join-Path $targetRoot "cypress-realworld-app" }
$npmCache = Join-Path $targetRoot "npm-cache"

if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
  throw "Portable Node is missing at $nodeDir. Run the Node setup step from docs/runbook.md first."
}

New-Item -ItemType Directory -Force $targetRoot | Out-Null

if (-not (Test-Path $repo)) {
  git clone "https://github.com/cypress-io/cypress-realworld-app.git" $repo
}

$env:PATH = "$nodeDir;$env:PATH"
$env:CYPRESS_INSTALL_BINARY = "0"
$env:HUSKY = "0"

Push-Location $repo
try {
  if (-not (Test-Path "node_modules")) {
    & (Join-Path $nodeDir "npm.cmd") install --ignore-scripts --legacy-peer-deps --cache $npmCache
  }

  Copy-Item "scripts\mock-aws-exports.js" "src\aws-exports.js" -Force
  Copy-Item "scripts\mock-aws-exports-es5.js" "aws-exports-es5.js" -Force
  Copy-Item "data\database-seed.json" "data\database.json" -Force

  & (Join-Path $nodeDir "npx.cmd") patch-package
}
finally {
  Pop-Location
}

Write-Output "Demo target ready at $repo"
