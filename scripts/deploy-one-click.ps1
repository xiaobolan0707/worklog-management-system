[CmdletBinding()]
param(
  [string]$PackagePath,
  [string]$InstanceId = "i-uf68zhmu075bif384ns8",
  [string]$Region = "cn-shanghai",
  [string]$RemoteDir = "/opt/worklog",
  [string]$Profile,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Workbench {
  param([string[]]$WorkbenchArgs)
  & workbench @WorkbenchArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Workbench CLI failed with exit code $LASTEXITCODE"
  }
}

if ([string]::IsNullOrWhiteSpace($PackagePath)) {
  $packageName = "worklog-letter-comments-upgrade.tar.gz"
  $sameDirectory = Join-Path $PSScriptRoot $packageName
  $outputsDirectory = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) $packageName
  $PackagePath = if (Test-Path -LiteralPath $sameDirectory -PathType Leaf) { $sameDirectory } else { $outputsDirectory }
}

if ($InstanceId -notmatch '^[A-Za-z0-9-]+$') { throw "Unsafe instance ID" }
if ($Region -notmatch '^[A-Za-z0-9-]+$') { throw "Unsafe region" }
if ($RemoteDir -notmatch '^/[A-Za-z0-9._/-]+$') { throw "Unsafe remote directory" }
if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) { throw "Release package not found: $PackagePath" }

$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$null = Get-Command workbench -ErrorAction Stop
$null = Get-Command tar -ErrorAction Stop
Invoke-Workbench @("version")

$archiveEntries = @(& tar -tzf $resolvedPackage)
if ($LASTEXITCODE -ne 0) { throw "Release package is unreadable or corrupt" }
$normalizedEntries = @($archiveEntries | ForEach-Object { $_ -replace '^\./', '' })
$unsafePattern = '(^|/)(\.env|node_modules|dist|\.git|\.superpowers|test-results|playwright-report|coverage)(/|$)|(^|/)\.\.(/|$)|^/'
$unsafeEntries = @($normalizedEntries | Where-Object { $_ -match $unsafePattern })
if ($unsafeEntries.Count -gt 0) {
  throw "Release package contains sensitive files or unsafe paths: $($unsafeEntries -join ', ')"
}

$requiredEntries = @(
  "compose.yaml",
  "Dockerfile",
  "prisma/migrations/20261012090000_letter_log_comments/migration.sql"
)
$missingEntries = @($requiredEntries | Where-Object { $normalizedEntries -notcontains $_ })
if ($missingEntries.Count -gt 0) { throw "Release package is missing required files: $($missingEntries -join ', ')" }

$stream = [IO.File]::OpenRead($resolvedPackage)
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $hash = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString("X2") })
}
finally {
  $stream.Dispose()
  $sha256.Dispose()
}
Write-Host "Release package validated: $resolvedPackage"
Write-Host "SHA256=$hash"
if ($ValidateOnly) {
  Write-Output "VALIDATION_OK FILES=$($normalizedEntries.Count) SHA256=$hash"
  exit 0
}

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("worklog-deploy-" + [Guid]::NewGuid().ToString("N"))
$uploadPackage = Join-Path $temporaryDirectory "worklog-letter-comments-upgrade.tar.gz"
$remoteScript = Join-Path $temporaryDirectory "deploy-worklog-upgrade.sh"
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

$remoteScriptContent = @'
#!/bin/sh
set -eu

deploy_dir="$1"
package="$2"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
code_backup="/root/worklog-code-before-letter-$timestamp.tar.gz"

if [ ! -d "$deploy_dir" ] || [ ! -f "$deploy_dir/.env" ]; then
  echo "Deployment directory or .env is missing: $deploy_dir" >&2
  exit 20
fi

cd "$deploy_dir"
docker compose config --quiet
docker compose exec -T backup /bin/sh /scripts/backup-postgres.sh
tar -czf "$code_backup" .

stage="$(mktemp -d /tmp/worklog-release.XXXXXX)"
trap 'rm -rf "$stage"' EXIT HUP INT TERM
tar -xzf "$package" -C "$stage"
test -f "$stage/compose.yaml"
test -f "$stage/Dockerfile"
test -f "$stage/prisma/migrations/20261012090000_letter_log_comments/migration.sql"
cp -a "$stage"/. "$deploy_dir"/

docker compose config --quiet
docker compose build app
docker compose up -d

attempt=0
while [ "$attempt" -lt 24 ]; do
  if curl -fsS http://127.0.0.1/health >/dev/null 2>&1; then
    docker compose ps
    rm -f "$package"
    echo "DEPLOY_OK CODE_BACKUP=$code_backup"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 5
done

docker compose ps >&2
docker compose logs --tail=100 app >&2
echo "Post-deployment health check failed; database and code backups were preserved." >&2
exit 30
'@

try {
  Copy-Item -LiteralPath $resolvedPackage -Destination $uploadPackage
  [IO.File]::WriteAllText($remoteScript, $remoteScriptContent, (New-Object Text.UTF8Encoding($false)))

  $commonArgs = @("--instance-id", $InstanceId, "--region", $Region, "--output", "json")
  if (-not [string]::IsNullOrWhiteSpace($Profile)) { $commonArgs += @("--profile", $Profile) }

  Write-Host "Uploading release package to instance $InstanceId ..."
  Invoke-Workbench (@("upload", $uploadPackage, "/tmp/", "--force") + $commonArgs)
  Invoke-Workbench (@("upload", $remoteScript, "/tmp/", "--force") + $commonArgs)

  $remoteCommand = "chmod 700 /tmp/deploy-worklog-upgrade.sh && /tmp/deploy-worklog-upgrade.sh $RemoteDir /tmp/worklog-letter-comments-upgrade.tar.gz"
  Write-Host "Backing up, building and updating services. Keep this window open ..."
  Invoke-Workbench (@("exec", "--command", $remoteCommand, "--timeout", "1800") + $commonArgs)
  Write-Output "DEPLOYMENT_OK INSTANCE=$InstanceId REGION=$Region SHA256=$hash"
}
finally {
  Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
