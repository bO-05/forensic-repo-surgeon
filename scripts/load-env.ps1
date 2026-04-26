param(
  [string]$Path = ".env.local"
)

$resolvedPath = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue

if (-not $resolvedPath) {
  return
}

Get-Content -LiteralPath $resolvedPath | ForEach-Object {
  $line = $_.Trim()

  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $separatorIndex = $line.IndexOf("=")

  if ($separatorIndex -lt 1) {
    return
  }

  $name = $line.Substring(0, $separatorIndex).Trim()
  $value = $line.Substring($separatorIndex + 1).Trim()

  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  Set-Item -Path "Env:$name" -Value $value
}
