param(
  [int64]$Hwnd = 0,
  [string]$Region = '',
  [int]$MaxWidth = 1280,
  [int]$Quality = 65,
  [string]$Format = 'jpeg'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32GameCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[void][Win32GameCapture]::SetProcessDPIAware()

$left = 0; $top = 0; $width = 0; $height = 0
if ($Hwnd -ne 0) {
  $rect = New-Object Win32GameCapture+RECT
  if (-not [Win32GameCapture]::GetWindowRect([IntPtr]$Hwnd, [ref]$rect)) { throw 'GetWindowRect failed' }
  $left = $rect.Left; $top = $rect.Top
  $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
} else {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $left = $bounds.Left; $top = $bounds.Top; $width = $bounds.Width; $height = $bounds.Height
}
if ($width -lt 2 -or $height -lt 2) { throw 'empty capture region' }

$crop = $null
if ($Region) {
  $parts = $Region -split '[,x\s]+' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ }
  if ($parts.Count -eq 4) {
    $crop = @{ x = $parts[0]; y = $parts[1]; w = $parts[2]; h = $parts[3] }
  }
}

$bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Black)
$captured = $false
if ($Hwnd -ne 0) {
  $hdc = $graphics.GetHdc()
  try { $captured = [Win32GameCapture]::PrintWindow([IntPtr]$Hwnd, $hdc, 2) } finally { $graphics.ReleaseHdc($hdc) }
}
if (-not $captured) {
  try {
    $graphics.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    $captured = $true
  } catch { $captured = $false }
}
$graphics.Dispose()
if (-not $captured) { $bitmap.Dispose(); throw 'screen capture failed' }

if ($crop) {
  $cx = [Math]::Max(0, [Math]::Min($crop.x, $bitmap.Width - 2))
  $cy = [Math]::Max(0, [Math]::Min($crop.y, $bitmap.Height - 2))
  $cw = [Math]::Max(2, [Math]::Min($crop.w, $bitmap.Width - $cx))
  $ch = [Math]::Max(2, [Math]::Min($crop.h, $bitmap.Height - $cy))
  $rect = New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)
  $cropped = $bitmap.Clone($rect, $bitmap.PixelFormat)
  $bitmap.Dispose()
  $bitmap = $cropped
}

if ($MaxWidth -gt 0 -and $bitmap.Width -gt $MaxWidth) {
  $newWidth = $MaxWidth
  $newHeight = [Math]::Max(1, [int]([Math]::Round($bitmap.Height * ($MaxWidth / $bitmap.Width))))
  $resized = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
  $g = [System.Drawing.Graphics]::FromImage($resized)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bitmap, 0, 0, $newWidth, $newHeight)
  $g.Dispose(); $bitmap.Dispose(); $bitmap = $resized
}

$stream = New-Object System.IO.MemoryStream
$formatName = if ($Format -eq 'png') { 'Png' } else { 'Jpeg' }
if ($formatName -eq 'Jpeg') {
  $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
  $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
  $bitmap.Save($stream, $encoder, $parameters)
} else {
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
}
$outWidth = $bitmap.Width
$outHeight = $bitmap.Height
$bytes = $stream.ToArray()
$bitmap.Dispose(); $stream.Dispose()

[ordered]@{
  ok = $true
  width = $outWidth
  height = $outHeight
  format = $formatName.ToLowerInvariant()
  bytes = $bytes.Length
  base64 = [Convert]::ToBase64String($bytes)
} | ConvertTo-Json -Compress
