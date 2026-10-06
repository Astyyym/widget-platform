@echo off
setlocal

set "APP_ROOT=%~dp0"
set "LOCAL_TOOL_ROOT=%APP_ROOT%..\prototypes\tauri-shell\.tools"
for %%I in ("%LOCAL_TOOL_ROOT%") do set "LOCAL_TOOL_ROOT=%%~fI"

if exist "%LOCAL_TOOL_ROOT%\cargo-home\bin\rustup.exe" (
  set "CARGO_HOME=%LOCAL_TOOL_ROOT%\cargo-home"
  set "RUSTUP_HOME=%LOCAL_TOOL_ROOT%\rustup-home"
  set "RUSTUP_TOOLCHAIN=1.98.1-x86_64-pc-windows-msvc"
)

if not defined CARGO_HOME set "CARGO_HOME=%USERPROFILE%\.cargo"
if not defined RUSTUP_HOME set "RUSTUP_HOME=%USERPROFILE%\.rustup"
set "PATH=%CARGO_HOME%\bin;%PATH%"

if not exist "%RUSTUP_HOME%\toolchains\1.98.1-x86_64-pc-windows-msvc" (
  echo Required Rust toolchain 1.98.1-x86_64-pc-windows-msvc is not installed under the selected RUSTUP_HOME. 1>&2
  exit /b 2
)

where rustup >nul 2>&1
if errorlevel 1 (
  echo rustup was not found in the selected CARGO_HOME. 1>&2
  exit /b 2
)

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo vswhere.exe was not found at the Visual Studio Installer location. 1>&2
  exit /b 2
)

set "VS_INSTALLATION="
for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -all -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_INSTALLATION=%%I"
if not defined VS_INSTALLATION (
  echo Visual Studio C++ x64 tools were not found by vswhere. 1>&2
  exit /b 2
)

set "VCVARS64=%VS_INSTALLATION%\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS64%" (
  echo vcvars64.bat was not found under the selected Visual Studio installation. 1>&2
  exit /b 2
)

call "%VCVARS64%" >nul
if errorlevel 1 exit /b 2

cd /d "%APP_ROOT%"
call %*
set "APP_RUST_EXIT_CODE=%ERRORLEVEL%"
exit /b %APP_RUST_EXIT_CODE%
