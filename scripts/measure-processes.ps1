[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateRange(1, 2147483647)]
    [int]$RootPid,

    [ValidateRange(1, 86400)]
    [int]$DurationSeconds = 600,

    [ValidateRange(0, 3600)]
    [int]$WarmupSeconds = 120,

    [ValidateRange(1, 60)]
    [int]$SampleIntervalSeconds = 5,

    [ValidateSet('P0', 'P1')]
    [string]$Scenario = 'P0',

    [string]$ExpectedRootPath,

    [Parameter(Mandatory)]
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PercentileStats {
    param([double[]]$Values)

    $sorted = @($Values | Sort-Object)
    if ($sorted.Count -eq 0) {
        return [ordered]@{ Count = 0; Mean = $null; P95 = $null; Peak = $null }
    }

    $p95Index = [Math]::Max(0, [Math]::Ceiling(0.95 * $sorted.Count) - 1)
    return [ordered]@{
        Count = $sorted.Count
        Mean  = [Math]::Round((($sorted | Measure-Object -Average).Average), 6)
        P95   = [Math]::Round($sorted[$p95Index], 6)
        Peak  = [Math]::Round($sorted[-1], 6)
    }
}

function Get-ProcessTreeSnapshot {
    param(
        [int]$RootProcessId,
        [string]$ExpectedPath,
        [long]$ExpectedStartTicks
    )

    $root = Get-Process -Id $RootProcessId -ErrorAction Stop
    if (-not [string]::Equals($root.Path, $ExpectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Root PID $RootProcessId no longer refers to the expected release executable."
    }
    if ($root.StartTime.ToUniversalTime().Ticks -ne $ExpectedStartTicks) {
        throw "Root PID $RootProcessId was reused by another process."
    }

    $processes = @(Get-CimInstance -ClassName Win32_Process -Property @(
        'ProcessId', 'ParentProcessId', 'Name', 'CreationDate', 'KernelModeTime', 'UserModeTime'
    ))
    $byPid = @{}
    foreach ($process in $processes) {
        $byPid[[int]$process.ProcessId] = $process
    }
    if (-not $byPid.ContainsKey($RootProcessId)) {
        throw "Root PID $RootProcessId was absent from the process snapshot."
    }

    $memberIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$memberIds.Add($RootProcessId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $processes) {
            $processId = [int]$process.ProcessId
            if (-not $memberIds.Contains($processId) -and $memberIds.Contains([int]$process.ParentProcessId)) {
                [void]$memberIds.Add($processId)
                $changed = $true
            }
        }
    }

    return @($memberIds | ForEach-Object { $byPid[$_] } | Sort-Object ProcessId)
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$expectedRootPath = if ([string]::IsNullOrWhiteSpace($ExpectedRootPath)) {
    Join-Path $repoRoot 'prototypes/tauri-shell/src-tauri/target/release/widget-platform-tauri-shell-g1b.exe'
} else {
    $ExpectedRootPath
}
if (-not (Test-Path -LiteralPath $expectedRootPath -PathType Leaf)) {
    throw "Expected release executable was not found: $expectedRootPath"
}
$expectedRootPath = (Resolve-Path -LiteralPath $expectedRootPath).Path
$rootProcess = Get-Process -Id $RootPid -ErrorAction Stop
if (-not [string]::Equals($rootProcess.Path, $expectedRootPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "RootPid must identify this prototype's release executable: $expectedRootPath"
}
$rootStartTicks = $rootProcess.StartTime.ToUniversalTime().Ticks
$rootStartUtc = $rootProcess.StartTime.ToUniversalTime().ToString('o')
$rootSha256 = (Get-FileHash -LiteralPath $expectedRootPath -Algorithm SHA256).Hash.ToLowerInvariant()

$outputBase = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -Path $outputBase -ItemType Directory -Force | Out-Null
$runId = '{0}-pid{1}' -f [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ'), $RootPid
$runDirectory = Join-Path $outputBase $runId
New-Item -Path $runDirectory -ItemType Directory | Out-Null

$logicalProcessors = [int](Get-CimInstance -ClassName Win32_ComputerSystem -Property NumberOfLogicalProcessors).NumberOfLogicalProcessors
if ($logicalProcessors -lt 1) {
    throw 'Logical processor count was unavailable; CPU normalization cannot be reported.'
}

$counterSetName = 'Process V2'
$counterScope = '\' + $counterSetName + '(' 

$samples = [System.Collections.Generic.List[object]]::new()
$inventory = @{}
$previousCpuTicks = @{}
$previousSampleUtc = $null
$previousMemberKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$cpuErrors = 0
$memoryErrors = 0

Write-Output ("ROOT_PID={0}" -f $RootPid)
Write-Output ("ROOT_PATH={0}" -f $expectedRootPath)
Write-Output ("ROOT_START_UTC={0}" -f $rootStartUtc)
Write-Output ("LOGICAL_PROCESSORS={0}" -f $logicalProcessors)
Write-Output ("WARMUP_SECONDS={0}" -f $WarmupSeconds)
Write-Output ("DURATION_SECONDS={0}" -f $DurationSeconds)
Write-Output ("SAMPLE_INTERVAL_SECONDS={0}" -f $SampleIntervalSeconds)

$warmupRemaining = $WarmupSeconds
while ($warmupRemaining -gt 0) {
    $sleepSeconds = [Math]::Min(30, $warmupRemaining)
    Start-Sleep -Seconds $sleepSeconds
    $warmupRemaining -= $sleepSeconds
    Write-Output ("WARMUP_REMAINING_SECONDS={0}" -f $warmupRemaining)
}

$samplingStartedUtc = [DateTimeOffset]::UtcNow
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$sampleNumber = 0
$disappearedProcessCount = 0

while (($sampleNumber * $SampleIntervalSeconds) -le $DurationSeconds) {
    $targetSeconds = $sampleNumber * $SampleIntervalSeconds
    $delaySeconds = $targetSeconds - $stopwatch.Elapsed.TotalSeconds
    if ($delaySeconds -gt 0) {
        Start-Sleep -Milliseconds ([int][Math]::Ceiling($delaySeconds * 1000))
    }

    $sampleUtc = [DateTimeOffset]::UtcNow
    $members = @(Get-ProcessTreeSnapshot -RootProcessId $RootPid -ExpectedPath $expectedRootPath -ExpectedStartTicks $rootStartTicks)
    $currentCpuTicks = @{}
    $cpuDeltaTicks = [decimal]0
    $currentMemberKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $sampleProcessRows = [System.Collections.Generic.List[object]]::new()

    foreach ($member in $members) {
        $processId = [int]$member.ProcessId
        $creationKey = if ($null -eq $member.CreationDate) { 'unknown' } else { [string]$member.CreationDate }
        $processKey = '{0}|{1}' -f $processId, $creationKey
        [void]$currentMemberKeys.Add($processKey)
        $ticks = [decimal]$member.KernelModeTime + [decimal]$member.UserModeTime
        $currentCpuTicks[$processKey] = $ticks

        if ($sampleNumber -gt 0 -and $previousCpuTicks.ContainsKey($processKey)) {
            $cpuDeltaTicks += ($ticks - [decimal]$previousCpuTicks[$processKey])
        } elseif ($sampleNumber -gt 0) {
            # A newly observed descendant has existed only during this measured interval.
            $cpuDeltaTicks += $ticks
        }

        if (-not $inventory.ContainsKey($processKey)) {
            $inventory[$processKey] = [PSCustomObject]@{
                PID          = $processId
                ParentPID    = [int]$member.ParentProcessId
                Name         = [string]$member.Name
                CreationDate = $creationKey
                FirstSeenUtc = $sampleUtc.ToString('o')
                LastSeenUtc  = $sampleUtc.ToString('o')
            }
        } else {
            $inventory[$processKey].LastSeenUtc = $sampleUtc.ToString('o')
        }

        $sampleProcessRows.Add([PSCustomObject]@{
            PID = $processId
            ParentPID = [int]$member.ParentProcessId
            Name = [string]$member.Name
            ProcessKey = $processKey
        })
    }

    $exitedSincePrevious = 0
    if ($sampleNumber -gt 0) {
        foreach ($previousKey in $previousMemberKeys) {
            if (-not $currentMemberKeys.Contains($previousKey)) {
                $exitedSincePrevious++
                $disappearedProcessCount++
            }
        }
    }

    $elapsedWallSeconds = $null
    $cpuDeltaSeconds = $null
    $cpuMachinePercent = $null
    if ($null -ne $previousSampleUtc) {
        $elapsedWallSeconds = ($sampleUtc - $previousSampleUtc).TotalSeconds
        if ($elapsedWallSeconds -gt 0 -and $cpuDeltaTicks -ge 0) {
            $cpuDeltaSeconds = [double]($cpuDeltaTicks / 10000000)
            $cpuMachinePercent = ($cpuDeltaSeconds / ($elapsedWallSeconds * $logicalProcessors)) * 100
        } else {
            $cpuErrors++
        }
    }

    $privateWorkingSetBytes = $null
    $privateBytes = $null
    $memoryErrorType = ''
    $memoryErrorMessage = ''
    $memoryQueryRetryUsed = $false
    $memoryFirstQueryErrorType = ''
    $memoryFirstQueryErrorMessage = ''
    $missingCounterPids = [System.Collections.Generic.List[int]]::new()
    $counterPaths = [System.Collections.Generic.List[string]]::new()
    $pidCounterPaths = @{}
    if ($members.Count -gt 0) {
        try {
            foreach ($member in $members) {
                $processId = [int]$member.ProcessId
                $processName = [System.IO.Path]::GetFileNameWithoutExtension([string]$member.Name)
                if ([string]::IsNullOrWhiteSpace($processName)) {
                    $missingCounterPids.Add($processId)
                    continue
                }

                $instanceName = '{0}:{1}' -f $processName, $processId
                $workingSetPath = '\{0}({1})\Working Set - Private' -f $counterSetName, $instanceName
                $privateBytesPath = '\{0}({1})\Private Bytes' -f $counterSetName, $instanceName
                $pidCounterPaths[$processId] = @($workingSetPath, $privateBytesPath)
                $counterPaths.Add($workingSetPath)
                $counterPaths.Add($privateBytesPath)
            }

            if ($missingCounterPids.Count -eq 0 -and $counterPaths.Count -gt 0) {
                $counterMap = [System.Collections.Generic.Dictionary[string, double]]::new([StringComparer]::OrdinalIgnoreCase)
                try {
                    $counterResult = Get-Counter -Counter $counterPaths.ToArray() -ErrorAction Stop
                } catch {
                    $memoryQueryRetryUsed = $true
                    $memoryFirstQueryErrorType = $_.Exception.GetType().Name
                    $memoryFirstQueryErrorMessage = $_.Exception.Message
                    $counterResult = Get-Counter -Counter $counterPaths.ToArray() -ErrorAction Stop
                }
                foreach ($counterSample in $counterResult.CounterSamples) {
                    $counterIndex = $counterSample.Path.LastIndexOf($counterScope, [StringComparison]::OrdinalIgnoreCase)
                    if ($counterIndex -lt 0) {
                        continue
                    }
                    $normalizedPath = $counterSample.Path.Substring($counterIndex)
                    $counterValue = [double]$counterSample.CookedValue
                    if ([double]::IsNaN($counterValue) -or [double]::IsInfinity($counterValue) -or $counterValue -lt 0) {
                        continue
                    }
                    $counterMap[$normalizedPath] = $counterValue
                }

                $workingSetSum = [double]0
                $privateBytesSum = [double]0
                $allMetricsPresent = $true
                foreach ($processId in $pidCounterPaths.Keys) {
                    $paths = $pidCounterPaths[$processId]
                    if (-not $counterMap.ContainsKey($paths[0]) -or -not $counterMap.ContainsKey($paths[1])) {
                        $allMetricsPresent = $false
                        break
                    }
                    $workingSetSum += $counterMap[$paths[0]]
                    $privateBytesSum += $counterMap[$paths[1]]
                }
                if ($allMetricsPresent -and $pidCounterPaths.Count -eq $members.Count) {
                    $privateWorkingSetBytes = [long][Math]::Round($workingSetSum)
                    $privateBytes = [long][Math]::Round($privateBytesSum)
                } else {
                    $memoryErrors++
                }
            } else {
                $memoryErrors++
            }
        } catch {
            $memoryErrors++
            $memoryErrorType = $_.Exception.GetType().Name
            $memoryErrorMessage = $_.Exception.Message
        }
    } else {
        $memoryErrors++
    }

    $samples.Add([PSCustomObject]@{
        SampleNumber = $sampleNumber
        SampleUtc = $sampleUtc.ToString('o')
        ElapsedWallSeconds = $elapsedWallSeconds
        ProcessCount = $members.Count
        ProcessPids = (($members | ForEach-Object { [int]$_.ProcessId }) -join ';')
        ExitedSincePreviousSample = $exitedSincePrevious
        CpuGroupDeltaSeconds = $cpuDeltaSeconds
        CpuMachineTotalPercent = $cpuMachinePercent
        PrivateWorkingSetBytes = $privateWorkingSetBytes
        PrivateBytes = $privateBytes
        MissingCounterPids = ($missingCounterPids -join ';')
        MemoryCounterRetryUsed = $memoryQueryRetryUsed
        MemoryCounterFirstQueryErrorType = $memoryFirstQueryErrorType
        MemoryCounterFirstQueryErrorMessage = $memoryFirstQueryErrorMessage
        MemoryCounterErrorType = $memoryErrorType
        MemoryCounterErrorMessage = $memoryErrorMessage
    })

    $previousCpuTicks = $currentCpuTicks
    $previousMemberKeys = $currentMemberKeys
    $previousSampleUtc = $sampleUtc
    $sampleNumber++
}

$stopwatch.Stop()
$actualSamplingSeconds = $stopwatch.Elapsed.TotalSeconds
$samplingEndedUtc = [DateTimeOffset]::UtcNow
$cpuSamples = @($samples | Where-Object { $null -ne $_.CpuMachineTotalPercent } | ForEach-Object { [double]$_.CpuMachineTotalPercent })
$workingSetSamples = @($samples | Where-Object { $null -ne $_.PrivateWorkingSetBytes } | ForEach-Object { [double]$_.PrivateWorkingSetBytes })
$privateBytesSamples = @($samples | Where-Object { $null -ne $_.PrivateBytes } | ForEach-Object { [double]$_.PrivateBytes })
$cpuStats = Get-PercentileStats -Values $cpuSamples
$workingSetStats = Get-PercentileStats -Values $workingSetSamples
$privateBytesStats = Get-PercentileStats -Values $privateBytesSamples
$inventoryRows = @($inventory.Values | Sort-Object PID, CreationDate)
$webViewPids = @($inventoryRows | Where-Object { $_.Name -ieq 'msedgewebview2.exe' } | ForEach-Object { [int]$_.PID })

$cpuMetricStatus = if ($cpuSamples.Count -eq [Math]::Max(0, $samples.Count - 1) -and $cpuErrors -eq 0 -and $disappearedProcessCount -eq 0) { 'PASS' } else { 'UNVERIFIED' }
$workingSetMetricStatus = if ($workingSetSamples.Count -eq $samples.Count) { 'PASS' } else { 'UNVERIFIED' }
$privateBytesMetricStatus = if ($privateBytesSamples.Count -eq $samples.Count) { 'PASS' } else { 'UNVERIFIED' }
$cpuThresholdStatus = if ($cpuMetricStatus -ne 'PASS') { 'UNVERIFIED' } elseif ($cpuStats.Mean -le 0.2) { 'PASS' } else { 'FAIL' }
$workingSetThresholdStatus = if ($workingSetMetricStatus -ne 'PASS') { 'UNVERIFIED' } elseif ($workingSetStats.Mean -le (150 * 1MB)) { 'PASS' } else { 'FAIL' }
$protocolStatus = if ($WarmupSeconds -ge 120 -and $DurationSeconds -ge 600 -and $actualSamplingSeconds -ge 600) { 'PASS' } else { 'UNVERIFIED' }
$overallP0Status = if ($protocolStatus -ne 'PASS') {
    'UNVERIFIED'
} elseif ($cpuThresholdStatus -eq 'FAIL' -or $workingSetThresholdStatus -eq 'FAIL') {
    'FAIL'
} elseif ($cpuThresholdStatus -eq 'PASS' -and $workingSetThresholdStatus -eq 'PASS' -and $privateBytesMetricStatus -eq 'PASS') {
    'PASS'
} else {
    'UNVERIFIED'
}

$samplesPath = Join-Path $runDirectory 'samples.csv'
$inventoryPath = Join-Path $runDirectory 'processes.csv'
$summaryPath = Join-Path $runDirectory 'summary.json'
$samples | Export-Csv -LiteralPath $samplesPath -NoTypeInformation -Encoding utf8
$inventoryRows | Export-Csv -LiteralPath $inventoryPath -NoTypeInformation -Encoding utf8

$summary = [ordered]@{
    Scenario = if ($Scenario -eq 'P0') { 'P0 static synthetic summary' } else { 'P1 input panel' }
    RootPid = $RootPid
    RootPath = $expectedRootPath
    RootSha256 = $rootSha256
    RootStartUtc = $rootStartUtc
    SamplingStartedUtc = $samplingStartedUtc.ToString('o')
    SamplingEndedUtc = $samplingEndedUtc.ToString('o')
    WarmupSeconds = $WarmupSeconds
    RequestedDurationSeconds = $DurationSeconds
    ActualSamplingDurationSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
    MeasurementProtocolStatus = $protocolStatus
    SampleIntervalSeconds = $SampleIntervalSeconds
    SampleCount = $samples.Count
    LogicalProcessors = $logicalProcessors
    ProcessOwnership = 'Root PID plus current descendants observed from Win32_Process parent relationships at each sample.'
    ObservedProcessCount = $inventoryRows.Count
    WebView2DescendantPids = $webViewPids
    UnassignedSharedWebViewAttribution = 'UNVERIFIED: processes outside the observed root PID lineage are not included or inferred.'
    CpuMachineTotalPercent = $cpuStats
    CpuMetricStatus = $cpuMetricStatus
    CpuThresholdPercent = 0.2
    CpuThresholdStatus = $cpuThresholdStatus
    PrivateWorkingSetBytes = $workingSetStats
    PrivateWorkingSetMetricStatus = $workingSetMetricStatus
    PrivateWorkingSetThresholdBytes = 150 * 1MB
    PrivateWorkingSetThresholdStatus = $workingSetThresholdStatus
    PrivateBytes = $privateBytesStats
    PrivateBytesMetricStatus = $privateBytesMetricStatus
    CpuSampleErrors = $cpuErrors
    MemoryCounterErrors = $memoryErrors
    MemoryCounterRetries = @($samples | Where-Object { $_.MemoryCounterRetryUsed }).Count
    CounterSetName = $counterSetName
    DisappearedProcessObservations = $disappearedProcessCount
    OverallP0ThresholdStatus = if ($Scenario -eq 'P0') { $overallP0Status } else { 'NOT_APPLICABLE' }
    ScenarioThresholdStatus = if ($Scenario -eq 'P0') { $overallP0Status } else { 'NOT_APPLICABLE: P1 is compared as a resource delta.' }
    Notes = @(
        'CPU group time uses Win32_Process KernelModeTime + UserModeTime deltas, divided by elapsed wall time and logical processor count.'
        'Working Set - Private and Private Bytes are process counters; no invalid or missing value is converted to zero.'
        'A descendant that starts and exits entirely between samples may not appear; short-lived child CPU time may be undercounted.'
        'Observed descendant exits make the CPU metric UNVERIFIED because final CPU time is unavailable; short diagnostics cannot pass the 120s warmup/600s protocol.'
        'GPU utilization and wakeups are not measured by this script.'
    )
    SamplesCsv = $samplesPath
    ProcessInventoryCsv = $inventoryPath
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding utf8

Write-Output ("RUN_DIRECTORY={0}" -f $runDirectory)
Write-Output ("SCENARIO={0}" -f $Scenario)
Write-Output ("SAMPLE_COUNT={0}" -f $samples.Count)
Write-Output ("CPU_MEAN_PERCENT={0}" -f $cpuStats.Mean)
Write-Output ("CPU_P95_PERCENT={0}" -f $cpuStats.P95)
Write-Output ("CPU_PEAK_PERCENT={0}" -f $cpuStats.Peak)
Write-Output ("PRIVATE_WORKING_SET_MEAN_MIB={0}" -f $(if ($null -ne $workingSetStats.Mean) { [Math]::Round($workingSetStats.Mean / 1MB, 3) } else { 'UNVERIFIED' }))
Write-Output ("PRIVATE_WORKING_SET_P95_MIB={0}" -f $(if ($null -ne $workingSetStats.P95) { [Math]::Round($workingSetStats.P95 / 1MB, 3) } else { 'UNVERIFIED' }))
Write-Output ("PRIVATE_WORKING_SET_PEAK_MIB={0}" -f $(if ($null -ne $workingSetStats.Peak) { [Math]::Round($workingSetStats.Peak / 1MB, 3) } else { 'UNVERIFIED' }))
Write-Output ("PRIVATE_BYTES_MEAN_MIB={0}" -f $(if ($null -ne $privateBytesStats.Mean) { [Math]::Round($privateBytesStats.Mean / 1MB, 3) } else { 'UNVERIFIED' }))
Write-Output ("WEBVIEW2_DESCENDANT_COUNT={0}" -f $webViewPids.Count)
Write-Output ("SCENARIO_THRESHOLD_STATUS={0}" -f $(if ($Scenario -eq 'P0') { $overallP0Status } else { 'NOT_APPLICABLE' }))
Write-Output ("SAMPLES_CSV={0}" -f $samplesPath)
Write-Output ("PROCESS_INVENTORY_CSV={0}" -f $inventoryPath)
Write-Output ("SUMMARY_JSON={0}" -f $summaryPath)
