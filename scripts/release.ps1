param(
    [string]$EvidenceDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'evidence\G8-B\build'),
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'
$runner = Join-Path $app 'run-msvc-rust.cmd'
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$run = Join-Path $EvidenceDirectory $runId
if (Test-Path -LiteralPath $run) { throw 'Build evidence directory already exists' }
New-Item -ItemType Directory -Path $run | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
$failure = $null
$startedAt = (Get-Date).ToUniversalTime()
$noticeRoot = Join-Path $app 'src-tauri\release-notices'
$stage = Join-Path $noticeRoot "staging\$runId"
$payload = Join-Path $noticeRoot 'payload'
function Invoke-Step([string]$Name, [string]$Executable, [string[]]$Arguments) {
    $log = Join-Path $run "$Name.log"
    "cwd=$app`nexecutable=$Executable`narguments=$($Arguments -join ' ')" | Set-Content -LiteralPath $log -Encoding utf8
    Write-Output "[$Name]"
    Push-Location -LiteralPath $app
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments 2>&1 | Out-File -LiteralPath $log -Append -Encoding utf8
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
        Pop-Location
    }
    if ($null -eq $code) { $code = 1 }
    $results.Add([pscustomobject]@{name=$Name; exitCode=$code; log=$log; executable=$Executable; arguments=$Arguments})
    Write-Output "[$Name] exit=$code"
    if ($code -ne 0) { throw "$Name failed with exit $code; see $log" }
}
try {
    if ($env:VITE_G2C_PROBE -or $env:TAURI_CONFIG -or $env:CARGO_TARGET_DIR -or $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) {
        throw 'Probe/debug/config/target override detected; refuse ambiguous release environment'
    }
    $config = Get-Content -LiteralPath (Join-Path $app 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $release = Get-Content -LiteralPath (Join-Path $app 'src-tauri\tauri.release.conf.json') -Raw | ConvertFrom-Json
    if ($config.identifier -ne 'com.widgetplatform.desktop' -or $release.bundle.windows.nsis.installMode -ne 'currentUser') { throw 'Identity/install-mode guard failed' }
    if ($release.bundle.createUpdaterArtifacts -ne $false -or $release.bundle.windows.webviewInstallMode.type -ne 'skip') { throw 'Updater/runtime side-effect guard failed' }
    Invoke-Step 'node-version' 'node.exe' @('--version')
    Invoke-Step 'npm-version' 'npm.cmd' @('--version')
    Invoke-Step 'rust-version' $runner @('rustc','--version')
    Invoke-Step 'cargo-version' $runner @('cargo','--version')
    Invoke-Step 'tauri-version' $runner @('npm.cmd','run','tauri','--','--version')
    Invoke-Step 'js-typecheck' 'npm.cmd' @('run','typecheck')
    Invoke-Step 'js-test' 'npm.cmd' @('test','--','--run')
    Invoke-Step 'js-build' 'npm.cmd' @('run','build')
    Invoke-Step 'rust-fmt' $runner @('cargo','fmt','--manifest-path','src-tauri/Cargo.toml','--check')
    Invoke-Step 'rust-test' $runner @('cargo','test','--manifest-path','src-tauri/Cargo.toml','--locked')
    Invoke-Step 'rust-release-check' $runner @('cargo','check','--manifest-path','src-tauri/Cargo.toml','--release','--locked')
    # Cargo stdout is metadata, not a fabricated fixture. Keep stderr in its own log.
    $metadata = Join-Path $run 'cargo-metadata.json'
    Push-Location -LiteralPath $app
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $runner cargo metadata --manifest-path src-tauri/Cargo.toml --locked --offline --format-version 1 --filter-platform x86_64-pc-windows-msvc 2> (Join-Path $run 'cargo-metadata.stderr.log') | Set-Content -LiteralPath $metadata -Encoding utf8
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference; Pop-Location }
    if ($code -ne 0) { throw "Cargo metadata failed: $code" }
    Invoke-Step 'collect-notices' $Python @((Join-Path $PSScriptRoot 'collect-release-notices.py'),'--metadata',$metadata,'--output',$stage)
    if (Test-Path -LiteralPath $payload) {
        $previous = Join-Path $noticeRoot "previous\$runId"
        New-Item -ItemType Directory -Path (Split-Path $previous -Parent) -Force | Out-Null
        Move-Item -LiteralPath $payload -Destination $previous
    }
    Move-Item -LiteralPath $stage -Destination $payload
    Invoke-Step 'release-nsis' $runner @('npm.cmd','run','tauri','--','build','--config','src-tauri/tauri.release.conf.json','--bundles','nsis','--','--locked')
    $exe = Join-Path $app 'src-tauri\target\release\widget-platform-app.exe'
    $installers = @(Get-ChildItem -LiteralPath (Join-Path $app 'src-tauri\target\release\bundle\nsis') -Filter '*-setup.exe' | Where-Object { $_.LastWriteTimeUtc -ge $startedAt })
    if ($installers.Count -ne 1 -or -not (Test-Path -LiteralPath $exe)) { throw 'Fresh exact installer/EXE not found' }
    $artifacts = @($exe, $installers[0].FullName) | ForEach-Object {
        $item = Get-Item -LiteralPath $_
        $signature = Get-AuthenticodeSignature -LiteralPath $_
        [pscustomobject]@{path=$item.FullName; bytes=$item.Length; lastWriteTimeUtc=$item.LastWriteTimeUtc; sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLower(); authenticodeStatus=$signature.Status.ToString()}
    }
    $manifest = [pscustomobject]@{
        taskId='G8-B'; runId=$runId; status='built_local_test_candidate'; identifier=$config.identifier; version=$config.version
        features=@(); signed=$false; updaterEnabled=$false; webviewInstallMode='skip'; installMode='currentUser'
        scope='Local installation validation only. Formal release-risk acceptance remains unresolved.'
        artifacts=$artifacts; noticeInventory=Join-Path $payload 'dependency-notices.json'
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $run 'artifact-manifest.json') -Encoding utf8
    Write-Output "manifest=$(Join-Path $run 'artifact-manifest.json')"
} catch {
    $failure = $_.ToString()
    Write-Output "BUILD FAILED: $failure"
} finally {
    [pscustomobject]@{taskId='G8-B';runId=$runId;startedAtUtc=$startedAt;completedAtUtc=(Get-Date).ToUniversalTime();results=$results;failure=$failure} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $run 'summary.json') -Encoding utf8
    Write-Output "summary=$(Join-Path $run 'summary.json')"
}
if ($failure) { exit 1 }
exit 0
