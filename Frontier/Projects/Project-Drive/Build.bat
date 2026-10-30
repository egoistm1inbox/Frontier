@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "BUILD_DIR=%PROJECT_DIR%..\..\..\\.local\build\project-drive-win"
cmake -S "%PROJECT_DIR%." -B "%BUILD_DIR%" -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 exit /b 1
cmake --build "%BUILD_DIR%" --config Release --target ProjectDriveApp ProjectDrive -j 4
exit /b %ERRORLEVEL%
