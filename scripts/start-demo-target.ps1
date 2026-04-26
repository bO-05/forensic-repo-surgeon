$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $root ".env.local")
$nodeDir = Join-Path $root "tools\node-v22.12.0-win-x64"
$targetRoot = if ($env:SURGEON_TARGET_ROOT) { $env:SURGEON_TARGET_ROOT } else { Join-Path $root ".surgeon-targets" }
$repo = if ($env:SURGEON_TARGET_REPO) { $env:SURGEON_TARGET_REPO } else { Join-Path $targetRoot "cypress-realworld-app" }
$logDir = if ($env:SURGEON_TARGET_LOG_DIR) { $env:SURGEON_TARGET_LOG_DIR } else { Join-Path $targetRoot "logs" }
$pidFile = Join-Path $logDir "target-pids.json"
$tsNodeBin = Join-Path $repo "node_modules\ts-node\dist\bin.js"

function Wait-ForTcpPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
      return $true
    }
    Start-Sleep -Seconds 2
  }

  return $false
}

if (-not (Test-Path $repo)) {
  throw "Demo target is missing at $repo. Run scripts\setup-demo-target.ps1 first."
}

if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
  throw "Portable Node is missing at $nodeDir. Run scripts\setup-demo-target.ps1 first."
}

if (-not (Test-Path $tsNodeBin)) {
  throw "Local ts-node runtime is missing at $tsNodeBin. Reinstall target dependencies or run scripts\setup-demo-target.ps1 again."
}

New-Item -ItemType Directory -Force $logDir | Out-Null

& (Join-Path $PSScriptRoot "stop-demo-target.ps1") -Quiet

Copy-Item (Join-Path $repo "scripts\mock-aws-exports.js") (Join-Path $repo "src\aws-exports.js") -Force
Copy-Item (Join-Path $repo "scripts\mock-aws-exports-es5.js") (Join-Path $repo "aws-exports-es5.js") -Force
Copy-Item (Join-Path $repo "data\database-seed.json") (Join-Path $repo "data\database.json") -Force

$env:PATH = "$nodeDir;$env:PATH"

$api = Start-Process `
  -FilePath (Join-Path $nodeDir "node.exe") `
  -ArgumentList @($tsNodeBin, "--transpile-only", "-P", "tsconfig.tsnode.json", "--files", "backend/app.ts") `
  -WorkingDirectory $repo `
  -RedirectStandardOutput (Join-Path $logDir "api.out.log") `
  -RedirectStandardError (Join-Path $logDir "api.err.log") `
  -PassThru `
  -WindowStyle Hidden

if (-not (Wait-ForTcpPort -Port 3001 -TimeoutSeconds 180)) {
  $api.Refresh()
  if ($api.HasExited) {
    Write-Output "API exited early with code $($api.ExitCode). Check $logDir."
  }
  else {
    Write-Output "API did not become ready on http://localhost:3001. Check $logDir."
  }
  & (Join-Path $PSScriptRoot "stop-demo-target.ps1") -Quiet
  exit 1
}

$web = Start-Process `
  -FilePath (Join-Path $nodeDir "node.exe") `
  -ArgumentList @("node_modules\vite\bin\vite.js", "--host", "localhost") `
  -WorkingDirectory $repo `
  -RedirectStandardOutput (Join-Path $logDir "web.out.log") `
  -RedirectStandardError (Join-Path $logDir "web.err.log") `
  -PassThru `
  -WindowStyle Hidden

@{
  api = $api.Id
  web = $web.Id
  appUrl = "http://localhost:3000/signin"
  apiUrl = "http://localhost:3001"
  startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -Path $pidFile -Encoding utf8

$deadline = (Get-Date).AddMinutes(4)
$ready = $false

while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/signin" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ge 200) {
      $ready = $true
      break
    }
  }
  catch {
    Start-Sleep -Seconds 3
  }
}

if (-not $ready) {
  $web.Refresh()
  if ($web.HasExited) {
    Write-Output "Web app exited early with code $($web.ExitCode). Check $logDir."
  }
  else {
    Write-Output "App did not become ready. Check $logDir."
  }
  & (Join-Path $PSScriptRoot "stop-demo-target.ps1") -Quiet
  exit 1
}

Write-Output "Demo target ready at http://localhost:3000/signin"
Write-Output "api=$($api.Id) web=$($web.Id)"
