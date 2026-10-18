# Builds bettermv-encode.exe into dist\export (docs/EXPORT.md): the video encoder behind "下载 MV", compiled by the C#
# compiler of .NET Framework 4.x that every Windows 10/11 has. Called by pack-plugin.ps1 and install-plugin.ps1; the
# plugin's export\ folder gets it.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $csc)) { throw "找不到 $csc（需要 .NET Framework 4.x）" }
    New-Item -ItemType Directory -Force -Path 'dist\export' | Out-Null
    & $csc -nologo -optimize -platform:x64 -target:winexe -r:System.Web.Extensions.dll "-out:dist\export\bettermv-encode.exe" 'src\export\helper\BetterMVEncode.cs'
    if ($LASTEXITCODE -ne 0) { throw '视频编码程序编译失败' }
} finally { Pop-Location }
