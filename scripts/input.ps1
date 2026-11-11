param(
  [Parameter(Mandatory = $true)][string]$JsonPath,
  [int64]$Hwnd = 0,
  [ValidateSet('background', 'foreground')][string]$Mode = 'background'
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32GameInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
'@

$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101
$WM_CHAR = 0x0102
$WM_MOUSEMOVE = 0x0200
$WM_LBUTTONDOWN = 0x0201
$WM_LBUTTONUP = 0x0202
$WM_RBUTTONDOWN = 0x0204
$WM_RBUTTONUP = 0x0205
$WM_MBUTTONDOWN = 0x0207
$WM_MBUTTONUP = 0x0208
$WM_MOUSEWHEEL = 0x020A

$action = Get-Content -Raw -LiteralPath $JsonPath | ConvertFrom-Json
$handle = [IntPtr]$Hwnd

function Send-Key([int]$vk, [bool]$down) {
  if ($Mode -eq 'background') {
    $msg = if ($down) { $WM_KEYDOWN } else { $WM_KEYUP }
    $lParam = if ($down) { [IntPtr]1 } else { [IntPtr]0xC0000001 }
    [void][Win32GameInput]::PostMessage($handle, $msg, [IntPtr]$vk, $lParam)
  } else {
    $flags = if ($down) { 0 } else { 2 }
    [Win32GameInput]::keybd_event([byte]$vk, 0, $flags, [UIntPtr]::Zero)
  }
}

function Get-ClientPoint($x, $y) {
  $rect = New-Object Win32GameInput+RECT
  [void][Win32GameInput]::GetClientRect($handle, [ref]$rect)
  $cx = $rect.Right - $rect.Left
  $cy = $rect.Bottom - $rect.Top
  return @([int]($x * $cx), [int]($y * $cy), $cx, $cy)
}

if ($action.type -eq 'key') {
  $mods = @()
  if ($action.modifiers) { $mods = @($action.modifiers) }
  foreach ($mod in $mods) { Send-Key ([int]$mod) $true }
  $down = $action.action -ne 'up'
  $up = $action.action -ne 'down'
  if ($down) { Send-Key ([int]$action.vk) $true }
  if ($action.durationMs -and $down -and $up) { Start-Sleep -Milliseconds ([Math]::Min(3000, [int]$action.durationMs)) }
  if ($up) { Send-Key ([int]$action.vk) $false }
  for ($i = $mods.Count - 1; $i -ge 0; $i--) { Send-Key ([int]$mods[$i]) $false }
} elseif ($action.type -eq 'mouse') {
  $point = Get-ClientPoint ([double]$action.x) ([double]$action.y)
  $px = $point[0]; $py = $point[1]
  if ($Mode -eq 'background') {
    $packed = [IntPtr](($py -shl 16) -bor ($px -band 0xFFFF))
    [void][Win32GameInput]::PostMessage($handle, $WM_MOUSEMOVE, [IntPtr]::Zero, $packed)
    if ($action.action -ne 'move') {
      $button = [string]$action.button
      $downMsg = if ($button -eq 'right') { $WM_RBUTTONDOWN } elseif ($button -eq 'middle') { $WM_MBUTTONDOWN } else { $WM_LBUTTONDOWN }
      $upMsg = if ($button -eq 'right') { $WM_RBUTTONUP } elseif ($button -eq 'middle') { $WM_MBUTTONUP } else { $WM_LBUTTONUP }
      if ($action.action -ne 'up') { [void][Win32GameInput]::PostMessage($handle, $downMsg, [IntPtr]1, $packed) }
      if ($action.action -ne 'down') { [void][Win32GameInput]::PostMessage($handle, $upMsg, [IntPtr]0, $packed) }
    }
  } else {
    $screen = New-Object Win32GameInput+POINT
    $screen.X = $px; $screen.Y = $py
    [void][Win32GameInput]::ClientToScreen($handle, [ref]$screen)
    [void][Win32GameInput]::SetCursorPos($screen.X, $screen.Y)
    if ($action.action -ne 'move') {
      $downFlag = if ($action.button -eq 'right') { 0x0008 } elseif ($action.button -eq 'middle') { 0x0020 } else { 0x0002 }
      $upFlag = if ($action.button -eq 'right') { 0x0010 } elseif ($action.button -eq 'middle') { 0x0040 } else { 0x0004 }
      if ($action.action -ne 'up') { [Win32GameInput]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero) }
      if ($action.action -ne 'down') { [Win32GameInput]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero) }
    }
  }
} elseif ($action.type -eq 'text') {
  if ($Mode -ne 'background') { throw 'foreground text input is not implemented; use key actions' }
  foreach ($char in ([string]$action.text).ToCharArray()) {
    [void][Win32GameInput]::PostMessage($handle, $WM_CHAR, [IntPtr][int]$char, [IntPtr]1)
  }
} else {
  throw "unsupported action type: $($action.type)"
}
