# 启动 OpenAI 兼容桥（给 go-stock 用）。
# 用法：在 PowerShell 里执行  .\start-bridge.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "已创建 .env，请先填写 OPENAI_API_KEY / NIXTLA_API_KEY" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "首次运行，正在安装依赖..." -ForegroundColor Cyan
    npm install --no-audit --no-fund
}

Write-Host "启动 power-price-agent bridge..." -ForegroundColor Green
npm run bridge