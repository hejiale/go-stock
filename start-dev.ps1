# go-stock 开发模式启动脚本
# 使用便携版 Go + Wails CLI 启动 D:\go-stock-dev\go-stock-dev
# 注意：本文件必须保存为「UTF-8 带 BOM」，否则 Windows PowerShell 5.1
# 会按 ANSI 解码中文注释，可能吞掉换行、把后面的代码并进注释里。
$env:GOROOT  = 'D:\go-stock-dev\tools\go'
$env:GOPATH  = 'D:\go-stock-dev\tools\gopath'
$env:GOBIN   = 'D:\go-stock-dev\tools\bin'
$env:GOPROXY = 'https://goproxy.cn,direct'
$env:Path    = "$env:GOROOT\bin;$env:GOBIN;$env:Path"

# wails v2.17+ 的 dev server 增加了 Host 白名单校验（防 DNS rebinding）。
# Windows 开发模式下窗口加载的是 http://wails.localhost:34115，
# 不放行这个主机名会被 403 拒绝：进程都在跑，但窗口一直不出现。
$env:WAILS_DEV_ALLOWED_HOSTS = 'wails.localhost'

Write-Host '正在启动 go-stock 开发模式（wails dev）...' -ForegroundColor Cyan
Write-Host '首次启动会先构建前端、预热 Vite 依赖，可能要好几分钟；这期间窗口不会出现，属正常现象，请耐心等待。' -ForegroundColor DarkGray

Set-Location 'D:\go-stock-dev\go-stock-dev'
wails dev