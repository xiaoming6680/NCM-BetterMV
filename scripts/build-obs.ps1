# Builds the OBS output's files into dist\obs (docs/OBS.md): obs.js, the OBS page's script (vite.obs.config.ts), and
# bettermv-obs.exe, the local server, compiled by the C# compiler of .NET Framework 4.x that every Windows 10/11 has.
# Called by pack-plugin.ps1 and install-plugin.ps1; the plugin's obs\ folder gets these two and plugin\obs\index.html.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    bunx vite build --config vite.obs.config.ts
    if ($LASTEXITCODE -ne 0) { throw 'OBS 页面打包失败' }
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $csc)) { throw "找不到 $csc（需要 .NET Framework 4.x）" }
    & $csc -nologo -optimize -target:winexe "-out:dist\obs\bettermv-obs.exe" 'src\obs\helper\BetterMVObs.cs'
    if ($LASTEXITCODE -ne 0) { throw 'OBS 服务编译失败' }
} finally { Pop-Location }
