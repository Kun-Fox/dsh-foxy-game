param(
  [Parameter(Mandatory = $true)][string]$FlagFile,
  [string]$Key = 'F12'
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FoxyStopHotkey {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
'@

$map = @{
  F8 = 0x77; F9 = 0x78; F10 = 0x79; F11 = 0x7A; F12 = 0x7B
  ESCAPE = 0x1B; ESC = 0x1B; PAUSE = 0x13
}
$vk = $map[$Key.ToUpperInvariant()]
if (-not $vk) { throw "unsupported stop key: $Key" }

$wasDown = $false
while ($true) {
  $down = ([FoxyStopHotkey]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
  if ($down -and -not $wasDown) {
    Set-Content -LiteralPath $FlagFile -Value '1' -Encoding ascii
    break
  }
  $wasDown = $down
  Start-Sleep -Milliseconds 100
}
