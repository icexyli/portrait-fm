@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where gh >nul 2>nul
if errorlevel 1 (
  echo 请先安装 GitHub 官方命令行工具：
  echo.
  echo   winget install --id GitHub.cli --exact
  echo.
  echo 安装完成后重新打开此文件。
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-pages.ps1" -OpenBrowser %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
echo.
if "%DEPLOY_EXIT%"=="0" echo 已验证网站上线。
if "%DEPLOY_EXIT%"=="2" echo 部署尚待验证，请查看仓库 Actions 中的进度。
if "%DEPLOY_EXIT%"=="1" echo 部署已停止，请查看上方提示后再重试。
pause
exit /b %DEPLOY_EXIT%
