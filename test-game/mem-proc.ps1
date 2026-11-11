param(
  [string]$StateFile = "$env:TEMP\foxy-mem-proc.json",
  [int]$Value = 424242,
  [int]$Seconds = 120
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FoxyMemoryTest {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr VirtualAlloc(IntPtr address, UIntPtr size, uint allocationType, uint protect);
}
"@

$address = [FoxyMemoryTest]::VirtualAlloc([IntPtr]::Zero, [UIntPtr]::new(4096), 0x3000, 0x04)
$target = [FoxyMemoryTest]::VirtualAlloc([IntPtr]::Zero, [UIntPtr]::new(4096), 0x3000, 0x04)
if ($address -eq [IntPtr]::Zero -or $target -eq [IntPtr]::Zero) { throw 'VirtualAlloc failed' }
[System.Runtime.InteropServices.Marshal]::WriteInt64($address, $target.ToInt64())
[System.Runtime.InteropServices.Marshal]::WriteInt32([IntPtr]($target.ToInt64() + 0x10), $Value)

$payload = [pscustomobject]@{
  pid = $PID
  process = [System.Diagnostics.Process]::GetCurrentProcess().ProcessName
  address = ('0x{0:X}' -f $address.ToInt64())
  offsets = '0x10'
  value = $Value
}
$payload | ConvertTo-Json -Compress | Set-Content -Path $StateFile -Encoding utf8
Start-Sleep -Seconds $Seconds
