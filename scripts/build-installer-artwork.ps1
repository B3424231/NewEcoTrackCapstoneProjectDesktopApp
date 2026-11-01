param([string]$Version = '1.0.0')

# Packaging artwork only. Reuses the existing logo; does not change application data.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'assets\installer'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$logoPath = Join-Path $projectRoot 'assets\ecoTrack.png'
$sourceLogo = [System.Drawing.Image]::FromFile($logoPath)
$scale = 4
$navy = [System.Drawing.ColorTranslator]::FromHtml('#0b1220')
$green = [System.Drawing.ColorTranslator]::FromHtml('#34d399')
$foreground = [System.Drawing.ColorTranslator]::FromHtml('#f1f5f9')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#cbd5e1')
$markBounds = [System.Drawing.RectangleF]::new(320, 180, 600, 600)

function New-Artwork([int]$Width, [int]$Height) {
    $bitmap = [System.Drawing.Bitmap]::new($Width * $scale, $Height * $scale)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.ScaleTransform($scale, $scale)
    $graphics.Clear($navy)
    return @{ Bitmap = $bitmap; Graphics = $graphics; Width = $Width; Height = $Height }
}

function Write-ArtworkText($Canvas, [string]$Text, [float]$Size, [float]$X, [float]$Y, $Color, [bool]$Bold = $false) {
    $style = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $font = [System.Drawing.Font]::new('Segoe UI', $Size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = [System.Drawing.SolidBrush]::new($Color)
    $format = [System.Drawing.StringFormat]::GenericTypographic.Clone()
    try { $Canvas.Graphics.DrawString($Text, $font, $brush, $X, $Y, $format) }
    finally { $format.Dispose(); $brush.Dispose(); $font.Dispose() }
}

function Draw-BrandMark($Canvas, [float]$X, [float]$Y, [float]$Size) {
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    try { $Canvas.Graphics.FillRectangle($white, $X, $Y, $Size, $Size) }
    finally { $white.Dispose() }
    # The artwork mark is a crop of the existing logo, not a replacement drawing.
    $destination = [System.Drawing.RectangleF]::new($X + 5, $Y + 5, $Size - 10, $Size - 10)
    $Canvas.Graphics.DrawImage($sourceLogo, $destination, $markBounds, [System.Drawing.GraphicsUnit]::Pixel)
}

function Save-Artwork($Canvas, [string]$Name) {
    $Canvas.Graphics.Dispose()
    $final = [System.Drawing.Bitmap]::new($Canvas.Width, $Canvas.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($final)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($Canvas.Bitmap, 0, 0, $Canvas.Width, $Canvas.Height)
        $final.Save((Join-Path $outputDirectory ($Name + '.bmp')), [System.Drawing.Imaging.ImageFormat]::Bmp)
        $final.Save((Join-Path $outputDirectory ($Name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $final.Dispose(); $Canvas.Bitmap.Dispose() }
}

try {
    foreach ($action in @('installer', 'uninstaller')) {
        $sidebar = New-Artwork 164 314
        Draw-BrandMark $sidebar 18 20 128
        Write-ArtworkText $sidebar 'EcoTrack' 23 17 166 $green $true
        Write-ArtworkText $sidebar 'Aircon monitoring' 12 18 204 $foreground
        Write-ArtworkText $sidebar 'and control' 12 18 222 $foreground
        if ($action -eq 'installer') {
            Write-ArtworkText $sidebar 'Desktop setup' 12 18 263 $muted
            Write-ArtworkText $sidebar ('Version ' + $Version) 11 18 282 $muted
        } else {
            Write-ArtworkText $sidebar 'Uninstall EcoTrack' 12 18 263 $muted
            Write-ArtworkText $sidebar 'Local data is retained' 11 18 282 $muted
        }
        Save-Artwork $sidebar ($action + '-sidebar')
    }

    $header = New-Artwork 150 57
    Draw-BrandMark $header 8 8 41
    Write-ArtworkText $header 'EcoTrack' 17 57 17 $green $true
    Save-Artwork $header 'installer-header'

    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    $images = @()
    foreach ($size in $sizes) {
        $iconCanvas = New-Artwork $size $size
        # A white tile keeps the original navy/green mark legible at small sizes.
        $iconCanvas.Graphics.Clear([System.Drawing.Color]::White)
        $inset = [Math]::Max(0.75, $size / 16)
        $destination = [System.Drawing.RectangleF]::new($inset, $inset, $size - 2 * $inset, $size - 2 * $inset)
        $iconCanvas.Graphics.DrawImage($sourceLogo, $destination, $markBounds, [System.Drawing.GraphicsUnit]::Pixel)
        $iconCanvas.Graphics.Dispose()
        $final = [System.Drawing.Bitmap]::new($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($final)
        $stream = [System.IO.MemoryStream]::new()
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.DrawImage($iconCanvas.Bitmap, 0, 0, $size, $size)
            $final.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $images += ,$stream.ToArray()
            if ($size -eq 256) { $final.Save((Join-Path $outputDirectory 'app-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
        } finally { $stream.Dispose(); $g.Dispose(); $final.Dispose(); $iconCanvas.Bitmap.Dispose() }
    }
    $iconStream = [System.IO.File]::Create((Join-Path $outputDirectory 'ecotrack.ico'))
    $writer = [System.IO.BinaryWriter]::new($iconStream)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Length)
        $offset = 6 + 16 * $sizes.Length
        for ($i = 0; $i -lt $sizes.Length; $i++) {
            $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
            $offset += $images[$i].Length
        }
        foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
    } finally { $writer.Dispose(); $iconStream.Dispose() }

    $preview = [System.Drawing.Bitmap]::new(788, 736)
    $g = [System.Drawing.Graphics]::FromImage($preview)
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#e2e8f0'))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    foreach ($item in @(@('installer-sidebar.png', 24, 68, 328, 628), @('uninstaller-sidebar.png', 388, 68, 328, 628), @('installer-header.png', 24, 10, 150, 57))) {
        $image = [System.Drawing.Image]::FromFile((Join-Path $outputDirectory $item[0]))
        try { $g.DrawImage($image, [int]$item[1], [int]$item[2], [int]$item[3], [int]$item[4]) }
        finally { $image.Dispose() }
    }
    $preview.Save((Join-Path $outputDirectory 'artwork-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $preview.Dispose()
    Write-Output ('Created installer artwork in ' + $outputDirectory)
} finally { $sourceLogo.Dispose() }
