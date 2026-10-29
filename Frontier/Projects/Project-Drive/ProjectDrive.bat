@echo off
REM ============================================================================
REM  ProjectDrive.bat - open Project-Drive in Frontier.
REM
REM  Finds the Frontier executable and passes ProjectDrive.frontier on the
REM  command line so the project opens directly. Extra arguments are forwarded,
REM  e.g.  ProjectDrive.bat --headless
REM ============================================================================
setlocal

set "PROJECT=%~dp0ProjectDrive.frontier"

if defined FRONTIER_EXE (
    set "EXE=%FRONTIER_EXE%"
) else if exist "%~dp0..\..\Binaries\Frontier.exe" (
    set "EXE=%~dp0..\..\Binaries\Frontier.exe"
) else (
    set "EXE=Frontier.exe"
)

"%EXE%" --project "%PROJECT%" %*
exit /b %ERRORLEVEL%
