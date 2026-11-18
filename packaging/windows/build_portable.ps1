<#
.SYNOPSIS
  Build the Saturday-SWMM portable Windows release (zip with bundled Python).

.DESCRIPTION
  Produces dist\Saturday-SWMM-<version>-win64.zip containing:
    Saturday-SWMM.cmd   launcher (double-click)
    python\             official CPython embeddable distribution + locked deps
    app\                backend package
    ui\                 built web UI
    examples\           sample model
  Dependencies come from backend\requirements-windows.lock (exact versions,
  verified by hash), so every build of a given tag is reproducible.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packaging\windows\build_portable.ps1
#>
[CmdletBinding()]
param(
  [string]$PythonVersion = "3.13.7",
  [switch]$SkipFrontend
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Version = (Get-Content (Join-Path $Root "VERSION") -Raw).Trim()
$Dist = Join-Path $Root "dist"
$Stage = Join-Path $Dist "Saturday-SWMM"
$Cache = Join-Path $Dist ".cache"
$ZipName = "Saturday-SWMM-$Version-win64.zip"

Write-Host "Building Saturday-SWMM $Version (Python $PythonVersion)" -ForegroundColor Cyan
& python (Join-Path $Root "scripts\check_version.py")
if ($LASTEXITCODE -ne 0) { throw "Version numbers are out of sync (see above)." }

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage, $Cache | Out-Null

# --- 1. Embeddable CPython ---------------------------------------------------
$EmbedZip = Join-Path $Cache "python-$PythonVersion-embed-amd64.zip"
if (-not (Test-Path $EmbedZip)) {
  $url = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
  Write-Host "Downloading $url"
  Invoke-WebRequest $url -OutFile $EmbedZip
}
$Py = Join-Path $Stage "python"
Expand-Archive $EmbedZip -DestinationPath $Py
$Pth = Get-ChildItem $Py -Filter "python*._pth" | Select-Object -First 1
$zipStd = (Get-ChildItem $Py -Filter "python*.zip" | Select-Object -First 1).Name
# Parent folder on sys.path (so `import app` works) + site-packages + site.
@($zipStd, ".", "..", "Lib\site-packages", "import site") | Set-Content $Pth.FullName -Encoding ascii
$PyExe = Join-Path $Py "python.exe"

# --- 2. pip + locked dependencies ---------------------------------------------
$GetPip = Join-Path $Cache "get-pip.py"
if (-not (Test-Path $GetPip)) {
  Invoke-WebRequest "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPip
}
& $PyExe $GetPip --no-warn-script-location --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw "get-pip failed" }
& $PyExe -m pip install --no-warn-script-location --disable-pip-version-check `
  --prefer-binary --require-hashes -r (Join-Path $Root "backend\requirements-windows.lock")
if ($LASTEXITCODE -ne 0) { throw "dependency install failed" }

# --- 3. Web UI ------------------------------------------------------------------
$Fe = Join-Path $Root "frontend"
if (-not $SkipFrontend) {
  Push-Location $Fe
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
  Pop-Location
}
Copy-Item (Join-Path $Fe "dist") (Join-Path $Stage "ui") -Recurse

# --- 4. Backend, docs, examples ---------------------------------------------------
robocopy (Join-Path $Root "backend\app") (Join-Path $Stage "app") /E /XD __pycache__ /XF *.pyc err.txt out.txt _swmm2d.c /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy backend failed" }
Copy-Item (Join-Path $Root "VERSION") $Stage
Copy-Item (Join-Path $Root "VERSION") (Join-Path $Stage "app")
foreach ($f in "LICENSE", "NOTICE.md", "CHANGELOG.md") { Copy-Item (Join-Path $Root $f) $Stage }
Copy-Item (Join-Path $PSScriptRoot "Saturday-SWMM.cmd") $Stage
Copy-Item (Join-Path $PSScriptRoot "README.txt") $Stage
# Example projects: tracked files only (no previous run outputs).
$Ex = Join-Path $Stage "examples"
Push-Location $Root
git ls-files examples | ForEach-Object {
  $dest = Join-Path $Stage $_
  New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
  Copy-Item $_ $dest
}
Pop-Location
if (-not (Test-Path (Join-Path $Ex "sample.inp"))) { throw "examples missing" }

& $PyExe -m compileall -q (Join-Path $Stage "app") | Out-Null

# --- 5. Smoke test: the bundled interpreter imports every engine -----------------
& $PyExe -c "import app.main, openswmm.engine, pyswmm, rasterio, h5py; print('imports ok')"
if ($LASTEXITCODE -ne 0) { throw "smoke test failed" }

# --- 6. Zip + checksum -------------------------------------------------------------
$Zip = Join-Path $Dist $ZipName
if (Test-Path $Zip) { Remove-Item $Zip }
Compress-Archive -Path $Stage -DestinationPath $Zip -CompressionLevel Optimal
$hash = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower()
"$hash  $ZipName" | Set-Content (Join-Path $Dist "$ZipName.sha256") -Encoding ascii
Write-Host "Built $Zip" -ForegroundColor Green
Write-Host "SHA256 $hash"
