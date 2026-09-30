# Builds the plugin and installs it into BetterNCM's dev plugin folder. Restart NetEase Cloud Music afterwards.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    bunx vite build --config vite.plugin.config.ts
    if ($LASTEXITCODE -ne 0) { throw '打包失败' }
} finally { Pop-Location }
$dataPath = if ($env:BETTERNCM_PROFILE) { $env:BETTERNCM_PROFILE } else { 'C:\betterncm' }
$target = Join-Path $dataPath 'plugins_dev\ncm-better-mv'
New-Item -ItemType Directory -Force -Path (Join-Path $target 'fonts') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $target 'previews') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'plugin\manifest.json') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\plugin\bettermv.js') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'plugin\preview.jpg') -Destination $target -Force
Copy-Item -Path (Join-Path $projectRoot 'public\fonts\*.ttf') -Destination (Join-Path $target 'fonts') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'public\fonts\OFL.txt') -Destination (Join-Path $target 'fonts') -Force
Copy-Item -Path (Join-Path $projectRoot 'public\previews\*.webp') -Destination (Join-Path $target 'previews') -Force
Write-Output "已安装到 $target，重启网易云后生效。"
