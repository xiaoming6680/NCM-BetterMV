# Builds the plugin and packs it as dist/ncm-better-mv.plugin (a zip BetterNCM installs: manifest.json, bettermv.js,
# the store's preview.jpg, LICENSE, fonts/ with their licence, previews/ — the settings page's scene sketches, obs/ —
# the OBS output's page and local server). Entry names use forward slashes, which Compress-Archive on Windows
# PowerShell 5.1 does not.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    bunx vite build --config vite.plugin.config.ts
    if ($LASTEXITCODE -ne 0) { throw '打包失败' }
} finally { Pop-Location }
& (Join-Path $PSScriptRoot 'build-obs.ps1')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$out = Join-Path $projectRoot 'dist\ncm-better-mv.plugin'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $entries = @(
        @{ From = (Join-Path $projectRoot 'plugin\manifest.json'); Name = 'manifest.json' },
        @{ From = (Join-Path $projectRoot 'dist\plugin\bettermv.js'); Name = 'bettermv.js' },
        @{ From = (Join-Path $projectRoot 'plugin\preview.jpg'); Name = 'preview.jpg' },
        @{ From = (Join-Path $projectRoot 'LICENSE'); Name = 'LICENSE' },
        @{ From = (Join-Path $projectRoot 'public\fonts\OFL.txt'); Name = 'fonts/OFL.txt' },
        @{ From = (Join-Path $projectRoot 'plugin\obs\index.html'); Name = 'obs/index.html' },
        @{ From = (Join-Path $projectRoot 'dist\obs\obs.js'); Name = 'obs/obs.js' },
        @{ From = (Join-Path $projectRoot 'dist\obs\bettermv-obs.exe'); Name = 'obs/bettermv-obs.exe' }
    )
    foreach ($font in @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'public\fonts') -Filter '*.ttf') + @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'public\fonts') -Filter '*.woff2')) {
        $entries += @{ From = $font.FullName; Name = 'fonts/' + $font.Name }
    }
    foreach ($sketch in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'public\previews') -Filter '*.webp') {
        $entries += @{ From = $sketch.FullName; Name = 'previews/' + $sketch.Name }
    }
    foreach ($e in $entries) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $e.From, $e.Name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose() }
Write-Output "已生成 $out（$([math]::Round((Get-Item -LiteralPath $out).Length / 1MB, 2)) MB）。"
