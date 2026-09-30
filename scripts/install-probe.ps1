# Copies the probe into BetterNCM's dev plugin folder. Restart NetEase Cloud Music afterwards.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = if ($env:BETTERNCM_PROFILE) { $env:BETTERNCM_PROFILE } else { 'C:\betterncm' }
$target = Join-Path $dataPath 'plugins_dev\ncm-better-mv-probe'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $projectRoot 'probe\*') -Destination $target -Force
Write-Output "已安装到 $target，重启网易云后生效。"
