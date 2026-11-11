$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32GameWindows {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@

$items = @()
foreach ($process in Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }) {
  $handle = [IntPtr]$process.MainWindowHandle
  if (-not [Win32GameWindows]::IsWindowVisible($handle)) { continue }
  if ([Win32GameWindows]::IsIconic($handle)) { continue }
  $rect = New-Object Win32GameWindows+RECT
  if (-not [Win32GameWindows]::GetWindowRect($handle, [ref]$rect)) { continue }
  $width = [Math]::Max(0, $rect.Right - $rect.Left)
  $height = [Math]::Max(0, $rect.Bottom - $rect.Top)
  if ($width -lt 120 -or $height -lt 80) { continue }
  $items += [ordered]@{
    hwnd = [int64]$process.MainWindowHandle
    title = [string]$process.MainWindowTitle
    process = [string]$process.ProcessName
    x = $rect.Left
    y = $rect.Top
    width = $width
    height = $height
  }
}
$items | Sort-Object title | ConvertTo-Json -Compress -Depth 4
