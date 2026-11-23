@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules\electron\package.json" (
  echo 首次运行，正在安装 Electron（约 100MB，请保持网络畅通）...
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo 安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

start "" "%CD%\node_modules\.bin\electron.cmd" "%CD%"
