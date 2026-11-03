# go-stock 开发模式启动脚本
# 使用便携版 Go + Wails CLI 启动 D:\go-stock-dev\go-stock-dev
$env:GOROOT  = 'D:\go-stock-dev\tools\go'
$env:GOPATH  = 'D:\go-stock-dev\tools\gopath'
$env:GOBIN   = 'D:\go-stock-dev\tools\bin'
$env:GOPROXY = 'https://goproxy.cn,direct'
$env:Path    = "$env:GOROOT\bin;$env:GOBIN;$env:Path"

Set-Location 'D:\go-stock-dev\go-stock-dev'
wails dev