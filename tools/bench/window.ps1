# NetEase Cloud Music's main window for the bench: `front` restores it and brings it to the front (a hidden or
# minimized window gets no animation frames, so nothing would be drawn), `min` minimizes it, `rect` prints its bounds.
param([string]$Action = 'front')
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class BmvWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public struct RECT { public int L, T, R, B; }
}
"@
$browser = (Get-CimInstance Win32_Process -Filter "Name='cloudmusic.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1).ProcessId
if (-not $browser) { 'no cloudmusic.exe'; exit 1 }
$script:main = [IntPtr]::Zero
[BmvWin]::EnumWindows({ param($h, $p)
  $q = 0; [void][BmvWin]::GetWindowThreadProcessId($h, [ref]$q)
  if ($q -eq $browser) { $sb = New-Object System.Text.StringBuilder 64; [void][BmvWin]::GetClassName($h, $sb, 64); if ($sb.ToString() -eq 'OrpheusBrowserHost') { $script:main = $h; return $false } }
  $true }, [IntPtr]::Zero) | Out-Null
if ($script:main -eq [IntPtr]::Zero) { 'no main window'; exit 1 }
switch ($Action) {
  'front' {
    [BmvWin]::ShowWindow($script:main, 9) | Out-Null   # SW_RESTORE
    # (A tap of Alt lets a background process hand over the foreground.)
    [BmvWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [BmvWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [BmvWin]::SetForegroundWindow($script:main) | Out-Null
    [BmvWin]::BringWindowToTop($script:main) | Out-Null
  }
  'min' { [BmvWin]::ShowWindow($script:main, 6) | Out-Null }   # SW_MINIMIZE
}
$r = New-Object BmvWin+RECT; [void][BmvWin]::GetWindowRect($script:main, [ref]$r)
"$($r.L),$($r.T),$($r.R),$($r.B) front=$([BmvWin]::GetForegroundWindow() -eq $script:main)"
