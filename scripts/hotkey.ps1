param(
  [Parameter(Mandatory = $true)][string]$FlagFile,
  [string]$Key = 'F8',
  [int]$PollMs = 80
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32GameHotkey {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
'@

$map = @{
  'F1'=112; 'F2'=113; 'F3'=114; 'F4'=115; 'F5'=116; 'F6'=117; 'F7'=118; 'F8'=119; 'F9'=120; 'F10'=121; 'F11'=122; 'F12'=123;
  'SPACE'=32; 'TAB'=9; 'ENTER'=13; 'ESC'=27; 'ESCAPE'=27; 'SHIFT'=16; 'CTRL'=17; 'CONTROL'=17; 'ALT'=18
}
$vk = if ($map.ContainsKey($Key.ToUpperInvariant())) { $map[$Key.ToUpperInvariant()] } elseif ($Key.Length -eq 1) { [int][char]$Key.ToUpperInvariant() } else { 119 }
$down = $false
while (-not (Test-Path -LiteralPath "$FlagFile.stop")) {
  $state = [Win32GameHotkey]::GetAsyncKeyState($vk) -band 0x8000
  $isDown = $state -ne 0
  if ($isDown -ne $down) {
    $down = $isDown
    if ($down) { Set-Content -LiteralPath "$FlagFile.down" -Value ([DateTime]::UtcNow.ToString('o')) -Encoding UTF8 }
    else { Remove-Item -LiteralPath "$FlagFile.down" -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds $PollMs
}
Remove-Item -LiteralPath "$FlagFile.down" -Force -ErrorAction SilentlyContinue
