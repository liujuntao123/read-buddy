Add-Type -AssemblyName System.Drawing
foreach ($f in @('font18','font26')) {
  $bmp = New-Object System.Drawing.Bitmap("C:\Users\admin\myspace\read-buddy\.scratch\shots\$f.png")
  $w = $bmp.Width; $h = $bmp.Height
  $dark = 0; $total = 0
  $x0 = [int]($w * 0.2); $x1 = [int]($w * 0.8)
  $y0 = [int]($h * 0.2); $y1 = [int]($h * 0.8)
  for ($x = $x0; $x -lt $x1; $x += 2) {
    for ($y = $y0; $y -lt $y1; $y += 2) {
      $c = $bmp.GetPixel($x, $y)
      $total++
      if (($c.R + $c.G + $c.B) -lt 380) { $dark++ }
    }
  }
  Write-Host "$f : ${w}x${h} dark-ink ratio = $([math]::Round(100 * $dark / $total, 2))%"
  $bmp.Dispose()
}
