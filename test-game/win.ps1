param(
  [string]$StateFile = (Join-Path $env:TEMP 'foxy-win-game.json')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$state = @{ x = 0; y = 0; last = ''; steps = 0 }
function Save-State {
  $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $StateFile -Encoding utf8
}
Save-State

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Foxy Win Test'
$form.Width = 440
$form.Height = 300
$form.StartPosition = 'CenterScreen'
$form.KeyPreview = $true

$label = New-Object System.Windows.Forms.Label
$label.Dock = [System.Windows.Forms.DockStyle]::Fill
$label.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$label.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 18)
$form.Controls.Add($label)

function Update-Label {
  $label.Text = "($($state.x), $($state.y))`r`nWASD / arrows`r`nlast: $($state.last)"
}

$form.Add_KeyDown({
  param($sender, $event)
  $key = $event.KeyCode.ToString()
  switch ($key) {
    'W' { $state.y -= 1; $state.last = 'up' }
    'S' { $state.y += 1; $state.last = 'down' }
    'A' { $state.x -= 1; $state.last = 'left' }
    'D' { $state.x += 1; $state.last = 'right' }
    'Up' { $state.y -= 1; $state.last = 'up' }
    'Down' { $state.y += 1; $state.last = 'down' }
    'Left' { $state.x -= 1; $state.last = 'left' }
    'Right' { $state.x += 1; $state.last = 'right' }
    default { return }
  }
  $state.steps += 1
  Save-State
  Update-Label
  $event.SuppressKeyPress = $true
})

Update-Label
[void]$form.ShowDialog()
