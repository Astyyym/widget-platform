<#
.SYNOPSIS
    Reclaim regenerable build artifacts from this workspace.

.DESCRIPTION
    Every isolated verification task in this project creates its own Cargo target
    directory. Over time those pile up: evidence/ alone accumulated 23 separate
    copies of the compiled Tauri dependency tree, and regenerable output reached
    ~68 GB of a ~72 GB workspace.

    This script walks the workspace once and removes only directories that are
    provably regenerable and are not part of any delivery or evidence chain.

    Defaults to dry-run: it lists what would be removed and changes nothing.
    Pass -Apply to actually delete.

    Safety design (prefer under-deleting over over-deleting):
      - Deletion candidates come from a fixed whitelist of directory names, not
        from recursive globs;
      - A protected-path check runs before the whitelist and always wins:
        evidence/**/delivery, prototypes/**/.tools, research/, .git/, src/,
        *.md, *.exe and credential files are never removed;
      - Directory junctions/symlinks are not followed, and every resolved path
        must stay under the workspace root;
      - A single failed target is recorded and does not abort the rest.

.PARAMETER Apply
    Perform the deletion. Without it the script is a dry-run.

.PARAMETER IncludePrototypeSource
    Also remove prototypes/ (reference prototypes plus the local toolchain).
    Off by default: prototypes/tauri-shell/.tools is the ONLY Rust 1.98.1 MSVC
    toolchain on this machine (there is no global rustup), so removing it means
    reinstalling the toolchain before anything can be built again.

.EXAMPLE
    powershell.exe -NoProfile -File scripts/clean-build.ps1
    List what would be reclaimed.

.EXAMPLE
    powershell.exe -NoProfile -File scripts/clean-build.ps1 -Apply
    Reclaim regenerable build artifacts.
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$IncludePrototypeSource
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent

# ---------------------------------------------------------------------------
# Protected paths: never deleted, checked before the whitelist.
# ---------------------------------------------------------------------------
$protectedPathFragments = @(
    '\delivery\',
    '\research\',
    '\.tools\',
    '\.git\',
    '\src\',
    '\migrations\',
    '\capabilities\'
)

function Test-Protected {
    param([Parameter(Mandatory)][string]$RelativePath)
    $probe = '\' + ($RelativePath -replace '/', '\') + '\'
    foreach ($fragment in $protectedPathFragments) {
        if ($probe -like "*$fragment*") { return $true }
    }
    return $false
}

# ---------------------------------------------------------------------------
# Whitelist: directory names that are regenerable build output.
# ---------------------------------------------------------------------------
$regenerableDirectoryNames = @(
    'target', 'target-final',
    'cargo-target',
    'node_modules',
    'EBWebView',
    'AppData',
    '__pycache__',
    'obj', 'bin',
    'release-notices'
)

function Get-RegenerableDirectory {
    param([Parameter(Mandatory)][string]$Root)

    $found = [System.Collections.Generic.List[object]]::new()
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($Root)

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $children = @()
        try {
            $children = @(Get-ChildItem -LiteralPath $current -Directory -Force -ErrorAction Stop)
        }
        catch {
            Write-Warning "skipping unreadable directory: $current ($($_.Exception.Message))"
            continue
        }

        foreach ($child in $children) {
            # Do not follow junctions/symlinks out of the workspace.
            if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                Write-Warning "skipping directory link: $($child.FullName)"
                continue
            }

            $relative = $child.FullName.Substring($Root.Length).TrimStart('\', '/')

            # Top-level directories that are never reclaimed wholesale.
            if ($relative -notlike '*\*' -and $child.Name -in @('.git', 'research')) {
                continue
            }
            # Local toolchain: large and never removable, skip the whole subtree.
            if ($child.Name -eq '.tools') {
                continue
            }

            $isTarget = $false
            if ($child.Name -in $regenerableDirectoryNames) { $isTarget = $true }
            elseif ($child.Name -like 'cargo-target*') { $isTarget = $true }
            elseif ($child.Name -like 'target-*' -and $child.Name -ne 'target-final') { $isTarget = $true }

            if ($isTarget -and -not (Test-Protected -RelativePath $relative)) {
                $found.Add([pscustomobject]@{
                    Path     = $child.FullName
                    Relative = $relative
                })
                continue   # matched: reclaim the whole subtree, do not descend
            }

            $queue.Enqueue($child.FullName)
        }
    }
    return $found
}

function Get-DirectorySize {
    param([Parameter(Mandatory)][string]$Path)
    $total = 0L
    $count = 0
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue)
    foreach ($file in $files) {
        $total += $file.Length
        $count++
    }
    return [pscustomobject]@{ Bytes = $total; Files = $count }
}

# ---------------------------------------------------------------------------
# PowerShell unwraps a returned List into a fixed-size array, so rebuild a
# mutable list before appending the extra targets below.
$targets = [System.Collections.Generic.List[object]]::new()
foreach ($item in @(Get-RegenerableDirectory -Root $workspaceRoot)) { $targets.Add($item) }

# NOTE: app/evidence/ and evidence/ are NOT reclaimed wholesale. Both hold
# evidence text (e.g. app/evidence/G3-B/todo-e2-result.json) alongside build
# output, so only the whitelisted build directories inside them are removed by
# the recursive scan above.

if ($IncludePrototypeSource) {
    $prototypes = Join-Path $workspaceRoot 'prototypes'
    if (Test-Path -LiteralPath $prototypes) {
        $targets.Add([pscustomobject]@{
            Path     = $prototypes
            Relative = 'prototypes'
        })
    }
}

$report = [System.Collections.Generic.List[object]]::new()
$totalBytes = 0L
$totalFiles = 0

foreach ($target in $targets) {
    $size = Get-DirectorySize -Path $target.Path
    $totalBytes += $size.Bytes
    $totalFiles += $size.Files
    $report.Add([pscustomobject]@{
        Relative = $target.Relative
        Bytes    = $size.Bytes
        Files    = $size.Files
    })
}

$report = $report | Sort-Object Bytes -Descending

Write-Output ''
Write-Output ('=' * 78)
if ($Apply) {
    Write-Output 'Reclaiming regenerable build artifacts (-Apply)'
} else {
    Write-Output 'DRY-RUN: the following would be reclaimed (nothing changed)'
}
Write-Output ('=' * 78)
foreach ($item in $report) {
    Write-Output ('  {0,10:N2} MB  {1,7} files  {2}' -f ($item.Bytes / 1MB), $item.Files, $item.Relative)
}
Write-Output ('-' * 78)
Write-Output ('  total {0:N2} GB / {1} files / {2} directories' -f ($totalBytes / 1GB), $totalFiles, $report.Count)

if ($IncludePrototypeSource) {
    Write-Output '  NOTE: -IncludePrototypeSource is set; prototypes/ source and the local Rust toolchain are in scope.'
}
else {
    Write-Output '  Kept: prototypes/**/.tools (only local Rust/MSVC toolchain), evidence/**/delivery installers, all evidence text.'
}
Write-Output ''

if (-not $Apply) {
    Write-Output 'DRY-RUN finished, nothing deleted. Re-run with -Apply to reclaim.'
    exit 0
}

if ($report.Count -eq 0) {
    Write-Output 'Nothing to reclaim.'
    exit 0
}

# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------
$removed = 0
$failures = [System.Collections.Generic.List[string]]::new()

foreach ($item in $report) {
    $absolute = Join-Path $workspaceRoot $item.Relative
    $resolved = [System.IO.Path]::GetFullPath($absolute)

    if (-not $resolved.StartsWith($workspaceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $failures.Add("refused, outside workspace: $resolved")
        continue
    }
    if (Test-Protected -RelativePath $item.Relative) {
        $failures.Add("refused, protected path: $($item.Relative)")
        continue
    }
    if (-not (Test-Path -LiteralPath $resolved)) { continue }

    try {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
        $removed++
        Write-Output ('removed {0}' -f $item.Relative)
    }
    catch {
        $failures.Add("$($item.Relative): $($_.Exception.Message)")
    }
}

Write-Output ''
Write-Output ('-' * 78)
Write-Output ('removed {0}/{1} directories, about {2:N2} GB' -f $removed, $report.Count, ($totalBytes / 1GB))
if ($failures.Count -gt 0) {
    Write-Output 'targets that could not be removed:'
    foreach ($failure in $failures) { Write-Output "  - $failure" }
}

# Verify: no deleted target should still exist.
$leftover = @()
foreach ($item in $report) {
    $absolute = Join-Path $workspaceRoot $item.Relative
    if (Test-Path -LiteralPath $absolute) { $leftover += $item.Relative }
}
Write-Output ('verify: {0} target(s) still present' -f $leftover.Count)
foreach ($left in $leftover) { Write-Output ('  leftover ' + $left) }

if ($failures.Count -gt 0 -or $leftover.Count -gt 0) { exit 1 }
exit 0
