$ErrorActionPreference = 'Stop'

$prototypeRoot = Split-Path -Parent $PSCommandPath
$zebarExe = Join-Path $prototypeRoot '.runtime/extracted/PFiles/glzr.io/Zebar/zebar.exe'
$profileRoot = Join-Path $prototypeRoot '.runtime-profile'
$roaming = Join-Path $profileRoot 'Roaming'
$local = Join-Path $profileRoot 'Local'
$configDir = Join-Path $prototypeRoot 'config'

if (-not (Test-Path -LiteralPath $zebarExe -PathType Leaf)) {
  throw "Local Zebar runtime not found: $zebarExe"
}

New-Item -ItemType Directory -Force -Path $roaming, $local | Out-Null
$env:APPDATA = $roaming
$env:LOCALAPPDATA = $local

$quotedConfigDir = '"' + $configDir + '"'
$process = Start-Process `
  -FilePath $zebarExe `
  -ArgumentList @('startup', '--config-dir', $quotedConfigDir) `
  -WorkingDirectory $prototypeRoot `
  -PassThru

[pscustomobject]@{
  ProcessId = $process.Id
  Executable = $zebarExe
  ConfigDirectory = $configDir
  IsolatedAppData = $profileRoot
}
