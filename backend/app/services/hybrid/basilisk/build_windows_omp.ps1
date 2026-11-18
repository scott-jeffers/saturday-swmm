# Rebuild bin/swmm2d-win64.exe on Windows with MinGW OpenMP (no WSL/qcc required).
# Requires a MinGW gcc with libgomp on PATH (e.g. WinLibs POSIX UCRT).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $here "bin"
$srcIn = Join-Path $bin "_swmm2d.c"
$srcOut = Join-Path $env:TEMP ("swmm2d-omp-{0}.c" -f [guid]::NewGuid().ToString("n"))
$py = Join-Path (Split-Path (Split-Path (Split-Path (Split-Path $here)))) ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  $py = "python"
}

$gcc = $null
foreach ($c in @("gcc", "x86_64-w64-mingw32-gcc")) {
  $cmd = Get-Command $c -ErrorAction SilentlyContinue
  if ($cmd) { $gcc = $cmd.Source; break }
}
if (-not $gcc) {
  throw "MinGW gcc not found on PATH. Install WinLibs (POSIX UCRT) or add gcc.exe to PATH."
}

& $py -c @"
import re
from pathlib import Path
src = Path(r'''$srcIn''')
dst = Path(r'''$srcOut''')
text = src.read_text(encoding='utf-8', errors='replace')
text2, n1 = re.subn(
    r'(?m)^#\s*define\s+OMP\(x\)\s*$',
    '#if _OPENMP\n'
    '# include <omp.h>\n'
    '# define OMP(x) _Pragma(#x)\n'
    '#else\n'
    '# define OMP(x)\n'
    '#endif',
    text,
    count=1,
)
text3, n2 = re.subn(
    r'(?m)^#define tid\(\) 0\s*\n#define pid\(\) 0\s*\n#define npe\(\) 1\s*$',
    '#if _OPENMP\n'
    '#define tid() omp_get_thread_num()\n'
    '#define pid() 0\n'
    '#define npe() omp_get_num_threads()\n'
    '#else\n'
    '#define tid() 0\n'
    '#define pid() 0\n'
    '#define npe() 1\n'
    '#endif',
    text2,
    count=1,
)
if n1 != 1 or n2 != 1:
    raise SystemExit(f'OpenMP patch failed (OMP={n1}, tid/npe={n2})')
dst.write_text(text3, encoding='utf-8', newline='\n')
print('patched', dst)
"@

$exe = Join-Path $bin "swmm2d-win64.exe"
$winshim = Join-Path $here "winshim"
& $gcc -O2 -fopenmp `
  "-I$winshim" "-include$(Join-Path $winshim 'wincompat.h')" `
  -o $exe $srcOut -lm -lgomp
if ($LASTEXITCODE -ne 0) { throw "gcc failed with exit $LASTEXITCODE" }

Copy-Item -Force $srcOut (Join-Path $bin "_swmm2d.c")
Remove-Item -Force $srcOut -ErrorAction SilentlyContinue

$mingwBin = Split-Path -Parent $gcc
foreach ($dll in @("libgomp-1.dll", "libwinpthread-1.dll", "libgcc_s_seh-1.dll")) {
  $srcDll = Join-Path $mingwBin $dll
  if (Test-Path -LiteralPath $srcDll) {
    Copy-Item -Force $srcDll (Join-Path $bin $dll)
    Write-Host "bundled $dll"
  }
}

Write-Host "built $exe (OpenMP via $gcc)"
