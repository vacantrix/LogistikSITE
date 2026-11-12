# Генерирует иконку LogistikSITE из фирменного знака LogoMark:
# графитовый квадрат со скруглёнными углами и оранжевая галочка.
# Результат: publish/assets/logistiksite.ico (16-256 px) и PNG-превью 512 px.
# Кадры 16-128 px пишутся в DIB (максимальная совместимость),
# кадр 256 px — в PNG (стандарт для Windows Vista+).

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetsDir = Join-Path $PSScriptRoot 'assets'
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

$sizes = @(16, 24, 32, 48, 64, 128, 256)

function New-LogoBitmap {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $Size / 64.0
    $radius = 14.5 * $s
    $d = $radius * 2

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $bg = [System.Drawing.ColorTranslator]::FromHtml('#1A1A1E')
    $brush = [System.Drawing.SolidBrush]::new($bg)
    $g.FillPath($brush, $path)

    $orange = [System.Drawing.ColorTranslator]::FromHtml('#EA580C')
    $width = [math]::Max(1.6, 6.4 * $s)
    $pen = [System.Drawing.Pen]::new($orange, [single]$width)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([single](13.6 * $s), [single](34.1 * $s)),
        [System.Drawing.PointF]::new([single](28.1 * $s), [single](48.1 * $s)),
        [System.Drawing.PointF]::new([single](52.9 * $s), [single](15.9 * $s))
    )
    $g.DrawLines($pen, $points)

    $pen.Dispose()
    $brush.Dispose()
    $path.Dispose()
    $g.Dispose()
    return $bmp
}

function Get-PngBytes {
    param([System.Drawing.Bitmap]$Bitmap)
    $ms = New-Object System.IO.MemoryStream
    $Bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return ,$bytes
}

function Get-DibBytes {
    param([System.Drawing.Bitmap]$Bitmap)

    $w = $Bitmap.Width
    $h = $Bitmap.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $stride = $data.Stride
        $raw = New-Object byte[] ($stride * $h)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
    } finally {
        $Bitmap.UnlockBits($data)
    }

    # DIB хранит строки снизу вверх.
    $xor = New-Object byte[] ($w * $h * 4)
    for ($y = 0; $y -lt $h; $y++) {
        $src = ($h - 1 - $y) * $stride
        $dst = $y * $w * 4
        [System.Array]::Copy($raw, $src, $xor, $dst, $w * 4)
    }

    # AND-маска: 1 = прозрачный пиксель (для очень старых оболочек).
    $maskStride = [int]([math]::Floor(($w + 31) / 32) * 4)
    $mask = New-Object byte[] ($maskStride * $h)
    for ($y = 0; $y -lt $h; $y++) {
        $row = $y * $w * 4
        $maskRow = $y * $maskStride
        for ($x = 0; $x -lt $w; $x++) {
            if ($xor[$row + $x * 4 + 3] -eq 0) {
                $mask[$maskRow + [int][math]::Floor($x / 8)] = $mask[$maskRow + [int][math]::Floor($x / 8)] -bor (1 -shl (7 - ($x % 8)))
            }
        }
    }

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([UInt32]40)              # biSize
    $bw.Write([Int32]$w)               # biWidth
    $bw.Write([Int32]($h * 2))         # biHeight: XOR + AND
    $bw.Write([UInt16]1)               # biPlanes
    $bw.Write([UInt16]32)              # biBitCount
    $bw.Write([UInt32]0)               # biCompression: BI_RGB
    $bw.Write([UInt32]($xor.Length + $mask.Length))
    $bw.Write([Int32]0)                # biXPelsPerMeter
    $bw.Write([Int32]0)                # biYPelsPerMeter
    $bw.Write([UInt32]0)               # biClrUsed
    $bw.Write([UInt32]0)               # biClrImportant
    $bw.Write($xor)
    $bw.Write($mask)
    $bw.Flush()
    $bytes = $ms.ToArray()
    $bw.Dispose()
    $ms.Dispose()
    return ,$bytes
}

$frames = @{}
foreach ($size in $sizes) {
    $bmp = New-LogoBitmap -Size $size
    if ($size -ge 256) {
        $frames[$size] = Get-PngBytes -Bitmap $bmp
    } else {
        $frames[$size] = Get-DibBytes -Bitmap $bmp
    }
    $bmp.Dispose()
}

# ICO: каталог + записи + данные кадров.
$icoPath = Join-Path $assetsDir 'logistiksite.ico'
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)

$offset = 6 + 16 * $sizes.Count
foreach ($size in $sizes) {
    $bytes = $frames[$size]
    $dim = if ($size -ge 256) { 0 } else { $size }
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
}
foreach ($size in $sizes) {
    $bw.Write($frames[$size])
}
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()

# Превью 512 px для проверки вручную.
$previewPath = Join-Path $assetsDir 'logistiksite-512.png'
$preview = New-LogoBitmap -Size 512
$preview.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)
$preview.Dispose()

Write-Output "Icon written: $icoPath ($((Get-Item $icoPath).Length) bytes, sizes: $($sizes -join ', '))"
Write-Output "Preview:      $previewPath"
