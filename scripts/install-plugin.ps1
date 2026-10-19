# Builds the plugin and installs it into BetterNCM's dev plugin folder. Restart NetEase Cloud Music afterwards.
# A development build: its version is dev-<version> (the manifest copied there and what the plugin shows).
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
$env:BMV_DEV_BUILD = '1'
try {
    bunx vite build --config vite.plugin.config.ts
    if ($LASTEXITCODE -ne 0) { throw '打包失败' }
} finally { Remove-Item Env:BMV_DEV_BUILD -ErrorAction SilentlyContinue; Pop-Location }
& (Join-Path $PSScriptRoot 'build-obs.ps1')
& (Join-Path $PSScriptRoot 'build-encode.ps1')
$dataPath = if ($env:BETTERNCM_PROFILE) { $env:BETTERNCM_PROFILE } else { 'C:\betterncm' }
$target = Join-Path $dataPath 'plugins_dev\ncm-better-mv'
New-Item -ItemType Directory -Force -Path (Join-Path $target 'fonts') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $target 'previews') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $target 'obs') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $target 'export') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'plugin\obs\index.html') -Destination (Join-Path $target 'obs') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\obs\obs.js') -Destination (Join-Path $target 'obs') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\obs\bettermv-obs.exe') -Destination (Join-Path $target 'obs') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\export\bettermv-encode.exe') -Destination (Join-Path $target 'export') -Force
$manifest = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'plugin\manifest.json')) -replace '"version":\s*"([^"]+)"', '"version": "dev-$1"'
[System.IO.File]::WriteAllText((Join-Path $target 'manifest.json'), $manifest, (New-Object System.Text.UTF8Encoding $false))
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\plugin\bettermv.js') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'plugin\preview.jpg') -Destination $target -Force
Copy-Item -Path (Join-Path $projectRoot 'public\fonts\*.ttf') -Destination (Join-Path $target 'fonts') -Force
Copy-Item -Path (Join-Path $projectRoot 'public\fonts\*.woff2') -Destination (Join-Path $target 'fonts') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'public\fonts\OFL.txt') -Destination (Join-Path $target 'fonts') -Force
Copy-Item -Path (Join-Path $projectRoot 'public\previews\*.webp') -Destination (Join-Path $target 'previews') -Force
Write-Output "已安装到 $target，重启网易云后生效。"
