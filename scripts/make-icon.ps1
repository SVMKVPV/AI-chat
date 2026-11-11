Add-Type -AssemblyName System.Drawing

$size = 1024
$outputPath = Join-Path $PSScriptRoot '..\build\icon.png'
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#111315'))

$panelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#20242A'))
$accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#65C18C'))
$textPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#F3F0E8'), 42)
$textPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$textPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#65C18C'), 28)
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$panelPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 62
$bounds = New-Object System.Drawing.Rectangle(248, 250, 528, 524)
$diameter = $radius * 2
$panelPath.AddArc($bounds.X, $bounds.Y, $diameter, $diameter, 180, 90)
$panelPath.AddArc($bounds.Right - $diameter, $bounds.Y, $diameter, $diameter, 270, 90)
$panelPath.AddArc($bounds.Right - $diameter, $bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
$panelPath.AddArc($bounds.X, $bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
$panelPath.CloseFigure()

$graphics.FillPath($panelBrush, $panelPath)
$graphics.DrawPath($accentPen, $panelPath)
$graphics.DrawLine($textPen, 356, 405, 668, 405)
$graphics.DrawLine($textPen, 356, 512, 560, 512)
$graphics.DrawLine($textPen, 356, 619, 668, 619)
$graphics.FillEllipse($accentBrush, 639, 461, 102, 102)
$graphics.DrawLine($accentPen, 707, 494, 775, 426)
$graphics.DrawLine($accentPen, 748, 426, 775, 426)
$graphics.DrawLine($accentPen, 775, 426, 775, 453)

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$panelBrush.Dispose()
$accentBrush.Dispose()
$textPen.Dispose()
$accentPen.Dispose()
$panelPath.Dispose()

Write-Output "Created $outputPath"
