@echo off
setlocal

set "G1D_ROOT=%~dp0"
set "DOTNET_ROOT=%G1D_ROOT%.tools\dotnet"
set "DOTNET_CLI_HOME=%G1D_ROOT%.tools\dotnet-home"
set "NUGET_PACKAGES=%G1D_ROOT%.tools\nuget"
set "PATH=%DOTNET_ROOT%;%DOTNET_ROOT%\tools;%PATH%"
set "DOTNET_CLI_TELEMETRY_OPTOUT=1"
set "DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1"

if not exist "%DOTNET_ROOT%\dotnet.exe" (
  echo Local .NET SDK not found: %DOTNET_ROOT%\dotnet.exe 1>&2
  exit /b 2
)

cd /d "%G1D_ROOT%"
call "%DOTNET_ROOT%\dotnet.exe" %*
set "G1D_EXIT_CODE=%ERRORLEVEL%"
exit /b %G1D_EXIT_CODE%
