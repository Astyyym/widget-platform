@echo off
setlocal

set "G1B_ROOT=%~dp0"
set "RUSTUP_HOME=%G1B_ROOT%.tools\rustup-home"
set "CARGO_HOME=%G1B_ROOT%.tools\cargo-home"
set "RUSTUP_TOOLCHAIN=1.98.1-x86_64-pc-windows-msvc"
set "PATH=%CARGO_HOME%\bin;%PATH%"

if not defined G1B_VCVARS64 set "G1B_VCVARS64=C:\Program\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%G1B_VCVARS64%" (
  echo MSVC environment script not found: %G1B_VCVARS64% 1>&2
  exit /b 2
)

call "%G1B_VCVARS64%" >nul
if errorlevel 1 exit /b %errorlevel%

cd /d "%G1B_ROOT%"
call %*
set "G1B_EXIT_CODE=%ERRORLEVEL%"
exit /b %G1B_EXIT_CODE%
