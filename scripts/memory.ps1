param(
  [string]$ProcessName = '',
  [int]$ProcessId = 0,
  [string]$ModuleName = '',
  [string]$Address = '',
  [string]$Offset = '',
  [string]$PointerOffsets = '',
  [string]$Type = 'int32',
  [string]$WriteValue = '',
  [switch]$Write
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Parse-Hex([string]$Value) {
  $text = $Value.Trim()
  if (-not $text) { return [int64]0 }
  if ($text -match '^0[xX]') { $text = $text.Substring(2) }
  return [Convert]::ToInt64($text, 16)
}

function Get-MemorySize([string]$Kind) {
  switch ($Kind) {
    'int32' { return 4 }
    'uint32' { return 4 }
    'int64' { return 8 }
    'float' { return 4 }
    'double' { return 8 }
    default { throw "unsupported memory type: $Kind" }
  }
}

if ($ProcessId -gt 0) {
  $proc = Get-Process -Id $ProcessId -ErrorAction Stop
} else {
  if (-not $ProcessName) { throw 'process or processId is required' }
  $name = $ProcessName -replace '\.exe$', ''
  $proc = Get-Process -Name $name -ErrorAction Stop | Select-Object -First 1
}

$module = $null
if ($ModuleName) {
  $module = $proc.Modules | Where-Object { $_.ModuleName -eq $ModuleName -or $_.FileName -like "*\$ModuleName" } | Select-Object -First 1
  if (-not $module) { throw "module not found: $ModuleName" }
} else {
  $module = $proc.MainModule
}
$base = [int64]$module.BaseAddress

if ($Address) {
  $target = Parse-Hex $Address
} else {
  $target = $base + (Parse-Hex $Offset)
}

$size = Get-MemorySize $Type
$buffer = New-Object byte[] $size
$read = [IntPtr]::Zero

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FoxyMemoryReader {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr read);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr written);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
}
"@

$access = if ($Write) { 0x0038 } else { 0x0010 }
$handle = [FoxyMemoryReader]::OpenProcess($access, $false, $proc.Id)
if ($handle -eq [IntPtr]::Zero) { throw "OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }

try {
  $offsets = @()
  if ($PointerOffsets) {
    $offsets = $PointerOffsets.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  }
  if ($offsets.Count -gt 0) {
    $pointerBuffer = New-Object byte[] 8
    $pointerRead = [IntPtr]::Zero
    foreach ($offset in $offsets) {
      if (-not [FoxyMemoryReader]::ReadProcessMemory($handle, [IntPtr]$target, $pointerBuffer, 8, [ref]$pointerRead)) {
        throw "ReadProcessMemory pointer failed at 0x$($target.ToString('X')): $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
      }
      $pointer = [BitConverter]::ToInt64($pointerBuffer, 0)
      $target = $pointer + (Parse-Hex $offset)
    }
  }

  if (-not [FoxyMemoryReader]::ReadProcessMemory($handle, [IntPtr]$target, $buffer, $size, [ref]$read)) {
    throw "ReadProcessMemory failed at 0x$($target.ToString('X')): $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  switch ($Type) {
    'int32' { $value = [BitConverter]::ToInt32($buffer, 0) }
    'uint32' { $value = [BitConverter]::ToUInt32($buffer, 0) }
    'int64' { $value = [BitConverter]::ToInt64($buffer, 0) }
    'float' { $value = [BitConverter]::ToSingle($buffer, 0) }
    'double' { $value = [BitConverter]::ToDouble($buffer, 0) }
  }
  $oldValue = $value
  $written = $false
  if ($Write) {
    if (-not $PSBoundParameters.ContainsKey('WriteValue')) { throw 'writeValue is required when writing memory' }
    $bytes = switch ($Type) {
      'int32' { [BitConverter]::GetBytes([int32]$WriteValue) }
      'uint32' { [BitConverter]::GetBytes([uint32]$WriteValue) }
      'int64' { [BitConverter]::GetBytes([int64]$WriteValue) }
      'float' { [BitConverter]::GetBytes([single]::Parse($WriteValue, [Globalization.CultureInfo]::InvariantCulture)) }
      'double' { [BitConverter]::GetBytes([double]::Parse($WriteValue, [Globalization.CultureInfo]::InvariantCulture)) }
    }
    $wrote = [IntPtr]::Zero
    if (-not [FoxyMemoryReader]::WriteProcessMemory($handle, [IntPtr]$target, $bytes, $bytes.Length, [ref]$wrote)) {
      throw "WriteProcessMemory failed at 0x$($target.ToString('X')): $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    if (-not [FoxyMemoryReader]::ReadProcessMemory($handle, [IntPtr]$target, $buffer, $size, [ref]$read)) {
      throw "ReadProcessMemory after write failed at 0x$($target.ToString('X')): $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    switch ($Type) {
      'int32' { $value = [BitConverter]::ToInt32($buffer, 0) }
      'uint32' { $value = [BitConverter]::ToUInt32($buffer, 0) }
      'int64' { $value = [BitConverter]::ToInt64($buffer, 0) }
      'float' { $value = [BitConverter]::ToSingle($buffer, 0) }
      'double' { $value = [BitConverter]::ToDouble($buffer, 0) }
    }
    $written = $true
  }
  [pscustomobject]@{
    ok = $true
    pid = $proc.Id
    process = $proc.ProcessName
    module = $module.ModuleName
    base = ('0x{0:X}' -f $base)
    address = ('0x{0:X}' -f $target)
    pointerOffsets = $PointerOffsets
    type = $Type
    value = $value
    oldValue = $oldValue
    written = $written
  } | ConvertTo-Json -Compress
}
finally {
  [void][FoxyMemoryReader]::CloseHandle($handle)
}
