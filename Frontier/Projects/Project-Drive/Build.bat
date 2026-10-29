@echo off
REM ============================================================================
REM  Build.bat - compile the Project-Drive code image (ProjectDrive.dll) via CMake.
REM ============================================================================
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "BUILD_DIR=%ROOT%Build\CMake"

cmake -S "%ROOT%" -B "%BUILD_DIR%" -DCMAKE_BUILD_TYPE=Release || exit /b 1
cmake --build "%BUILD_DIR%" --config Release || exit /b 1

echo ProjectDrive.dll built under %ROOT%Build\Output
exit /b 0
