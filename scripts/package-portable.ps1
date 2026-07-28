[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'build'))
$releaseRoot = Join-Path $buildRoot 'release'
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$runtime = & $nodeCommand -p 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})' |
    ConvertFrom-Json

if ($runtime.platform -ne 'win32') {
    throw "Windows portable packages must be built on Windows; current platform is $($runtime.platform)."
}
if ($runtime.arch -notin @('x64', 'arm64')) {
    throw "Unsupported Windows architecture for a portable package: $($runtime.arch)"
}

$artifactName = "pi-web-$($package.version)-win-$($runtime.arch)"
$stagingRoot = [IO.Path]::GetFullPath((Join-Path $buildRoot "portable\$artifactName"))
$archivePath = [IO.Path]::GetFullPath((Join-Path $releaseRoot "$artifactName.zip"))
$nodeArchiveName = "node-$($runtime.version)-win-$($runtime.arch).zip"
$nodeCacheRoot = [IO.Path]::GetFullPath((Join-Path $buildRoot "node-runtime\$($runtime.version)-win-$($runtime.arch)"))
$nodeArchivePath = Join-Path $nodeCacheRoot $nodeArchiveName
$nodeChecksumsPath = Join-Path $nodeCacheRoot 'SHASUMS256.txt'
$nodeExpandedRoot = Join-Path $nodeCacheRoot 'expanded'
$nodeDistributionRoot = Join-Path $nodeExpandedRoot ([IO.Path]::GetFileNameWithoutExtension($nodeArchiveName))

function Assert-PathUnderBuildRoot {
    param([Parameter(Mandatory)][string]$Path)

    $resolvedRoot = $buildRoot.TrimEnd('\') + '\'
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    if (-not $resolvedPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the build root: $resolvedPath"
    }
}

foreach ($path in @($stagingRoot, $archivePath, $nodeCacheRoot)) {
    Assert-PathUnderBuildRoot -Path $path
}

New-Item -ItemType Directory -Path $buildRoot,$releaseRoot,$nodeCacheRoot -Force | Out-Null
if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

$previousStandalone = $env:PI_WEB_STANDALONE
$previousNodeOptions = $env:NODE_OPTIONS
$previousTraceRoot = $env:PI_WEB_TRACE_ROOT
try {
    $env:PI_WEB_STANDALONE = '1'
    $env:PI_WEB_TRACE_ROOT = $repoRoot
    $preloadPath = (Join-Path $PSScriptRoot 'portable-build-preload.cjs').Replace('\', '/')
    $preloadOption = "--require=`"$preloadPath`""
    $env:NODE_OPTIONS = @($previousNodeOptions, $preloadOption).Where({ $_ }) -join ' '
    & $npmCommand run build
    if ($LASTEXITCODE -ne 0) {
        throw "Production standalone build failed with exit code $LASTEXITCODE."
    }
}
finally {
    $env:PI_WEB_STANDALONE = $previousStandalone
    $env:NODE_OPTIONS = $previousNodeOptions
    $env:PI_WEB_TRACE_ROOT = $previousTraceRoot
}

$standaloneRoot = Join-Path $repoRoot '.next\standalone'
$standaloneServer = Join-Path $standaloneRoot 'server.js'
$staticRoot = Join-Path $repoRoot '.next\static'
if (-not (Test-Path -LiteralPath $standaloneServer -PathType Leaf)) {
    throw "Standalone server was not generated: $standaloneServer"
}
if (-not (Test-Path -LiteralPath $staticRoot -PathType Container)) {
    throw "Next.js static assets were not generated: $staticRoot"
}

if (-not (Test-Path -LiteralPath $nodeArchivePath -PathType Leaf)) {
    Invoke-WebRequest `
        -Uri "https://nodejs.org/dist/$($runtime.version)/$nodeArchiveName" `
        -OutFile $nodeArchivePath
}
if (-not (Test-Path -LiteralPath $nodeChecksumsPath -PathType Leaf)) {
    Invoke-WebRequest `
        -Uri "https://nodejs.org/dist/$($runtime.version)/SHASUMS256.txt" `
        -OutFile $nodeChecksumsPath
}

$expectedNodeHash = $null
foreach ($line in Get-Content -LiteralPath $nodeChecksumsPath) {
    if ($line -match '^([a-fA-F0-9]{64})\s+(.+)$' -and $Matches[2] -eq $nodeArchiveName) {
        $expectedNodeHash = $Matches[1].ToLowerInvariant()
        break
    }
}
if (-not $expectedNodeHash) {
    throw "Node.js checksum is missing for $nodeArchiveName."
}
$actualNodeHash = (Get-FileHash -LiteralPath $nodeArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualNodeHash -ne $expectedNodeHash) {
    throw "Node.js archive checksum mismatch for $nodeArchiveName."
}

if (-not (Test-Path -LiteralPath (Join-Path $nodeDistributionRoot 'node.exe') -PathType Leaf)) {
    if (Test-Path -LiteralPath $nodeExpandedRoot) {
        Remove-Item -LiteralPath $nodeExpandedRoot -Recurse -Force
    }
    Expand-Archive -LiteralPath $nodeArchivePath -DestinationPath $nodeExpandedRoot
}
$nodeNpxCli = Join-Path $nodeDistributionRoot 'node_modules\npm\bin\npx-cli.js'
if (-not (Test-Path -LiteralPath $nodeNpxCli -PathType Leaf)) {
    throw "Official Node.js distribution is missing npm/npx: $nodeNpxCli"
}

$appRoot = Join-Path $stagingRoot 'app'
$runtimeRoot = Join-Path $stagingRoot 'runtime'
New-Item -ItemType Directory -Path $appRoot,$runtimeRoot -Force | Out-Null
Get-ChildItem -LiteralPath $standaloneRoot -Force |
    Copy-Item -Destination $appRoot -Recurse -Force

$staticTarget = Join-Path $appRoot '.next\static'
New-Item -ItemType Directory -Path $staticTarget -Force | Out-Null
Get-ChildItem -LiteralPath $staticRoot -Force |
    Copy-Item -Destination $staticTarget -Recurse -Force

$publicRoot = Join-Path $repoRoot 'public'
if (Test-Path -LiteralPath $publicRoot -PathType Container) {
    Copy-Item -LiteralPath $publicRoot -Destination (Join-Path $appRoot 'public') -Recurse -Force
}

Get-ChildItem -LiteralPath $nodeDistributionRoot -Force |
    Copy-Item -Destination $runtimeRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $nodeDistributionRoot 'LICENSE') -Destination (Join-Path $runtimeRoot 'NODE-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable-launcher.cjs') -Destination (Join-Path $stagingRoot 'launcher.cjs')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable-start.cmd') -Destination (Join-Path $stagingRoot 'start.cmd')
Set-Content -LiteralPath (Join-Path $runtimeRoot 'NODE-VERSION.txt') -Encoding UTF8 -Value $runtime.version

$packageReadme = @"
Pi Web $($package.version) Windows $($runtime.arch) portable package

This package includes Node.js $($runtime.version) with npm/npx; Node.js does not need to be installed separately.

Start:
  Double-click start.cmd

Default address:
  http://0.0.0.0:30141

Access from another computer on the same trusted network:
  http://<this-computer-LAN-IP>:30141

Optional arguments:
  start.cmd -H 127.0.0.1        Listen on this computer only
  start.cmd -H 0.0.0.0 -p 8080 Listen on all network interfaces with port 8080

Windows Defender Firewall may require an inbound rule for the selected port.
Pi Web has no application-level authentication. Never expose it directly to the internet.
"@
Set-Content -LiteralPath (Join-Path $stagingRoot 'README.txt') -Encoding UTF8 -Value $packageReadme

Compress-Archive -LiteralPath $stagingRoot -DestinationPath $archivePath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $prefix = "$artifactName/"
    foreach ($required in @(
        'start.cmd',
        'launcher.cjs',
        'runtime/node.exe',
        'runtime/npm.cmd',
        'runtime/npx.cmd',
        'runtime/node_modules/npm/bin/npm-cli.js',
        'runtime/node_modules/npm/bin/npx-cli.js',
        'runtime/NODE-LICENSE.txt',
        'app/server.js',
        'app/.next/BUILD_ID'
    )) {
        if ($entries -notcontains "$prefix$required") {
            throw "Portable package entry is missing: $required"
        }
    }
}
finally {
    $archive.Dispose()
}

$archiveSize = (Get-Item -LiteralPath $archivePath).Length
Write-Output "Portable package: $archivePath"
Write-Output "Embedded Node.js with npm/npx: $($runtime.version) ($($runtime.arch))"
Write-Output "Archive size: $([Math]::Round($archiveSize / 1MB, 1)) MiB"
Write-Output 'LAN start: start.cmd -H 0.0.0.0 -p 30141'
