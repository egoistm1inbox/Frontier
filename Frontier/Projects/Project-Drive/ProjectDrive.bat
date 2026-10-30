@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "EXE_PATH=%PROJECT_DIR%Binaries\ProjectDrive.exe"
if exist "%PROJECT_DIR%Binaries\Release\ProjectDrive.exe" set "EXE_PATH=%PROJECT_DIR%Binaries\Release\ProjectDrive.exe"
if not exist "%EXE_PATH%" call "%PROJECT_DIR%Build.bat"
"%EXE_PATH%" --project-root "%PROJECT_DIR%." %*
exit /b %ERRORLEVEL%
