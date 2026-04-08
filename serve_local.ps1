param(
  [int]$Port = 8080
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Static server running at $prefix"
Write-Host "Root: $root"
Write-Host "Press Ctrl+C to stop."

function Get-ContentType([string]$Path) {
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".svg" { "image/svg+xml" }
    default { "application/octet-stream" }
  }
}

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $requestPath = $context.Request.Url.AbsolutePath.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($requestPath)) {
      $requestPath = "index.html"
    }

    $fullPath = Join-Path $root $requestPath
    if (-not (Test-Path $fullPath -PathType Leaf)) {
      $context.Response.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $context.Response.Close()
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $context.Response.ContentType = Get-ContentType $fullPath
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  } catch {
    if ($listener.IsListening) {
      Write-Warning $_
    }
  }
}
