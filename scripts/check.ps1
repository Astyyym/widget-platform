param(
    [string]$EvidenceDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'evidence\G2-A\check')
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$appRoot = Join-Path $workspaceRoot 'app'
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$runDirectory = Join-Path $EvidenceDirectory $runId
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$script:results = [System.Collections.Generic.List[object]]::new()
$script:failureMessage = $null

function Invoke-LoggedCommand {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    $logPath = Join-Path $runDirectory "$Name.log"
    $commandLine = @(
        "name=$Name"
        "cwd=$WorkingDirectory"
        "executable=$Executable"
        "arguments=$($Arguments -join ' ')"
    ) -join [Environment]::NewLine
    Set-Content -LiteralPath $logPath -Value $commandLine -Encoding utf8
    Write-Output "[$Name] cwd=$WorkingDirectory"

    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Executable @Arguments 2>&1 | Tee-Object -FilePath $logPath -Append
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            $exitCode = 0
        }
    }
    catch {
        $_ | Out-String | Tee-Object -FilePath $logPath -Append
        $exitCode = 1
    }
    finally {
        Pop-Location
    }

    Add-Content -LiteralPath $logPath -Value "exit_code=$exitCode" -Encoding utf8
    $script:results.Add([pscustomobject]@{
        name = $Name
        cwd = $WorkingDirectory
        executable = $Executable
        arguments = $Arguments
        exitCode = $exitCode
        log = $logPath
    })
    Write-Output "[$Name] exit_code=$exitCode"

    if ($exitCode -ne 0) {
        throw "G2-A command '$Name' failed with exit code $exitCode. See $logPath"
    }
}

$rustRunner = Join-Path $appRoot 'run-msvc-rust.cmd'
try {
    Invoke-LoggedCommand -Name 'js-typecheck' -Executable 'npm' -Arguments @('run', 'typecheck') -WorkingDirectory $appRoot
    Invoke-LoggedCommand -Name 'js-test' -Executable 'npm' -Arguments @('test', '--', '--run') -WorkingDirectory $appRoot
    Invoke-LoggedCommand -Name 'js-build' -Executable 'npm' -Arguments @('run', 'build') -WorkingDirectory $appRoot
    Invoke-LoggedCommand -Name 'rust-fmt' -Executable $rustRunner -Arguments @('cargo', 'fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check') -WorkingDirectory $appRoot
    Invoke-LoggedCommand -Name 'rust-test' -Executable $rustRunner -Arguments @('cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked') -WorkingDirectory $appRoot
    Invoke-LoggedCommand -Name 'rust-check' -Executable $rustRunner -Arguments @('cargo', 'check', '--manifest-path', 'src-tauri/Cargo.toml', '--locked') -WorkingDirectory $appRoot
    Invoke-LoggedCommand -Name 'release-no-bundle' -Executable $rustRunner -Arguments @('npm', 'run', 'tauri', '--', 'build', '--no-bundle') -WorkingDirectory $appRoot
}
catch {
    $script:failureMessage = $_.ToString()
    Write-Output "G2-A check failed: $script:failureMessage"
}
finally {
    $summaryPath = Join-Path $runDirectory 'summary.json'
    $summary = [pscustomobject]@{
        taskId = 'G2-A'
        runId = $runId
        workspaceRoot = $workspaceRoot
        appRoot = $appRoot
        results = $script:results
        failure = $script:failureMessage
    }
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding utf8
    Write-Output "summary=$summaryPath"
}

if ($script:failureMessage -or $script:results.Count -ne 7 -or ($script:results | Where-Object exitCode -ne 0).Count -gt 0) {
    exit 1
}

exit 0
