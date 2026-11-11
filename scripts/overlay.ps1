param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [int]$FontSize = 22,
  [int]$MaxWidth = 760,
  [int]$BottomMargin = 90
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 30)
$form.Opacity = 0.88
$form.Width = $MaxWidth
$form.Height = 120

$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $false
$label.Dock = [System.Windows.Forms.DockStyle]::Fill
$label.Padding = New-Object System.Windows.Forms.Padding(18, 14, 18, 14)
$label.ForeColor = [System.Drawing.Color]::White
$label.BackColor = [System.Drawing.Color]::Transparent
$label.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', $FontSize, [System.Drawing.FontStyle]::Regular)
$label.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$form.Controls.Add($label)

$script:lastText = ''
$script:lastChange = [DateTime]::UtcNow
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
  try {
    $text = if (Test-Path -LiteralPath $TextFile) { Get-Content -Raw -LiteralPath $TextFile } else { '' }
    $text = ($text -replace '\s+$', '').Trim()
    if ($text -ne $script:lastText) {
      $script:lastText = $text
      $script:lastChange = [DateTime]::UtcNow
      $label.Text = $text
      $form.Height = [Math]::Max(76, [Math]::Min(260, 58 + ([Math]::Ceiling($text.Length / 34) * ($FontSize + 8))))
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
      $form.Left = [int](($screen.Width - $form.Width) / 2 + $screen.Left)
      $form.Top = [int]($screen.Bottom - $form.Height - $BottomMargin)
      $form.Visible = $text.Length -gt 0
    }
    if ($text.Length -gt 0 -and ([DateTime]::UtcNow - $script:lastChange).TotalSeconds -gt 14) {
      $label.Text = ''
      $script:lastText = ''
      $form.Visible = $false
    }
  } catch {}
})
$timer.Start()
$form.Add_Shown({ $form.Visible = $false })
[System.Windows.Forms.Application]::Run($form)
