param(
  [Parameter(Mandatory = $true)][string]$Text,
  [string]$Voice = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice) { $synth.SelectVoice($Voice) }
  $synth.Rate = 1
  $synth.Volume = 100
  $path = Join-Path $env:TEMP ("foxy-game-tts-" + [guid]::NewGuid().ToString('N') + '.wav')
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($Text)
  $synth.SetOutputToNull()
  $player = New-Object System.Media.SoundPlayer($path)
  $player.PlaySync()
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
} finally {
  $synth.Dispose()
}
