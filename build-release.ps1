# go-stock 一键打包发布版（Windows）
# 使用便携版 Go + Wails CLI，产物：go-stock-dev\build\bin\go-stock.exe
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File D:\go-stock-dev\build-release.ps1
#   powershell -ExecutionPolicy Bypass -File D:\go-stock-dev\build-release.ps1 -Tags custom
#   powershell -ExecutionPolicy Bypass -File D:\go-stock-dev\build-release.ps1 -Nsis
#   powershell -ExecutionPolicy Bypass -File D:\go-stock-dev\build-release.ps1 -SkipBindings   # 快，但 Go 接口变了要重新生成绑定
#
# 提示：打包前请先停掉正在运行的 wails dev / go-stock.exe，否则清理 build\bin 会失败。

[CmdletBinding()]
param(
    # 额外 Go 构建标签，例如 custom（定制版：无 OKX/合约、禁用自动更新）
    [string]$Tags = '',

    # 顺带生成 NSIS 安装包（需要本机已安装 NSIS，即 PATH 中有 makensis.exe）
    [switch]$Nsis,

    # 保留 build\bin 下的旧产物（默认先清理）
    [switch]$NoClean,

    # 跳过 wails 绑定生成（Go 暴露给前端的方法没变时可以加速几分钟）
    [switch]$SkipBindings,

    # 目标平台
    [string]$Platform = 'windows/amd64'
)

$ErrorActionPreference = 'Stop'

$Root    = 'D:\go-stock-dev'
$Project = Join-Path $Root 'go-stock-dev'
$Dist    = Join-Path $Project 'frontend\dist'

$env:GOROOT  = Join-Path $Root 'tools\go'
$env:GOPATH  = Join-Path $Root 'tools\gopath'
$env:GOBIN   = Join-Path $Root 'tools\bin'
$env:GOPROXY = 'https://goproxy.cn,direct'
$env:Path    = "$env:GOROOT\bin;$env:GOBIN;C:\Program Files\nodejs;$env:Path"

$Wails = Join-Path $env:GOBIN 'wails.exe'

# ---------- 前置检查 ----------
if (-not (Test-Path $Wails)) { throw "找不到 wails.exe：$Wails" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '未找到 npm，请确认 Node.js 已安装并在 PATH 中' }
if ($Nsis -and -not (Get-Command makensis -ErrorAction SilentlyContinue)) {
    throw '未找到 makensis（NSIS）。请先安装 NSIS，或去掉 -Nsis 参数只构建 exe。'
}

$running = Get-Process -Name 'go-stock', 'wails' -ErrorAction SilentlyContinue
if ($running) {
    throw '检测到 go-stock / wails 进程还在运行，请先关闭开发模式或已启动的发布版再打包。'
}

Set-Location $Project

# ---------- 1. 前端依赖 ----------
if (-not (Test-Path (Join-Path $Project 'frontend\node_modules'))) {
    Write-Host '[1/4] 安装前端依赖 (npm install) ...' -ForegroundColor Cyan
    Push-Location (Join-Path $Project 'frontend')
    npm install
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { throw "npm install 失败（exit $code）" }
} else {
    Write-Host '[1/4] 前端依赖已存在，跳过 npm install。' -ForegroundColor DarkGray
}

# ---------- 2. 前端构建 ----------
Write-Host '[2/4] 构建前端 (npm run build) ...' -ForegroundColor Cyan
Push-Location (Join-Path $Project 'frontend')
npm run build
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "前端构建失败（exit $code）" }

# ---------- 3. 重新落盘，绕开透明加密 ----------
# 本机有安全软件对 node 写出的 .js 做透明加密：vite 正常、wails dev 正常，
# 但 go 编译读到的会是密文（每个文件多 4096 字节头），打包后窗口一片空白。
# 用 PowerShell 复制一遍即可写成明文，再交给 go:embed。
Write-Host '[3/4] 重新落盘 dist（规避文件透明加密）...' -ForegroundColor Cyan
$tmpDist = Join-Path ([IO.Path]::GetTempPath()) ('go-stock-dist-' + [guid]::NewGuid().ToString('N'))
Copy-Item $Dist $tmpDist -Recurse -Force
Remove-Item $Dist -Recurse -Force
Copy-Item $tmpDist $Dist -Recurse -Force
# 安全软件可能还持有临时文件的句柄，删不掉也不影响构建，忽略即可
Remove-Item $tmpDist -Recurse -Force -ErrorAction SilentlyContinue

# 校验：最大的 js 开头必须是可读 ASCII，否则说明还是密文，打包必白屏
$bigJs = Get-ChildItem (Join-Path $Dist 'assets') -Filter '*.js' -ErrorAction SilentlyContinue |
    Sort-Object Length -Descending | Select-Object -First 1
if (-not $bigJs) { throw "未找到前端资源：$Dist\assets" }
$headBytes = [IO.File]::ReadAllBytes($bigJs.FullName)[0..31]
if ($headBytes | Where-Object { $_ -lt 9 -or $_ -gt 126 }) {
    throw "前端资源疑似被加密（$($bigJs.Name) 头部不是明文），打包后会白屏。请检查安全软件的透明加密策略。"
}
Write-Host ("      校验通过：{0} ({1:N0} 字节，明文)" -f $bigJs.Name, $bigJs.Length) -ForegroundColor DarkGray

# ---------- 4. 编译 ----------
$buildArgs = @('build')
if (-not $NoClean) { $buildArgs += '--clean' }
$buildArgs += @('--platform', $Platform)
$buildArgs += '-s'   # 前端已在第 2 步构建，避免 wails 再跑一次 npm 造成加密
if ($SkipBindings) { $buildArgs += '-skipbindings' }
if ($Tags) { $buildArgs += @('--tags', $Tags) }
if ($Nsis) { $buildArgs += '--nsis' }

$startedAt = Get-Date
Write-Host ("[4/4] " + $Wails + ' ' + ($buildArgs -join ' ')) -ForegroundColor Cyan
& $Wails @buildArgs
if ($LASTEXITCODE -ne 0) { throw "构建失败（exit $LASTEXITCODE）" }

# ---------- 结果 ----------
Write-Host ''
Write-Host '构建完成：' -ForegroundColor Green
$binDir = Join-Path $Project 'build\bin'
$outputs = Get-ChildItem $binDir -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $startedAt.AddMinutes(-1) }

if (-not $outputs) {
    Write-Warning "未找到新生成的 exe，请检查上方构建输出（目录：$binDir）"
} else {
    foreach ($f in $outputs) {
        $size = [math]::Round($f.Length / 1MB, 1)
        Write-Host ("  {0}  ({1} MB)" -f $f.FullName, $size)
    }
    Write-Host ''
    Write-Host '分发时只需 go-stock.exe（前端资源已内嵌）；不要带上 build\bin 下的 data / logs 目录。' -ForegroundColor Yellow
    if ($Nsis) {
        Write-Host '安装包文件名一般为 go-stock-amd64-installer.exe，可与 exe 一起上传到 GitHub Release。' -ForegroundColor Yellow
    }
}

# 显式返回 0，避免 -File 调用时把子进程残留的退出码当成脚本结果
exit 0