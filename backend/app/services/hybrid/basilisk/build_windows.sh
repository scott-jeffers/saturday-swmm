#!/usr/bin/env bash
# Rebuild bin/swmm2d-win64.exe from swmm2d.c with OpenMP enabled.
#
# Preferred (Linux / WSL with Basilisk):
#   sudo apt install mingw-w64 gcc   # or equivalent
#   # Basilisk: https://basilisk.fr — qcc on PATH, BASILISK set
#   ./build_windows.sh
#
# Steps:
#   1. qcc -fopenmp -source → portable C with live OMP() pragmas
#   2. x86_64-w64-mingw32-gcc -fopenmp -lgomp → Windows exe
#   3. winshim/ supplies POSIX bits (mmap, getrusage, sigaction)
#
# Fallback without qcc: patch an existing bin/_swmm2d.c (serial OMP no-ops
# → OpenMP-aware) and cross-compile the same way. Use build_windows_omp.ps1
# on a Windows host with MinGW if WSL is unavailable.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp "$here/swmm2d.c" "$tmp/"

# Prefer regenerating with OpenMP so OMP() expands to real pragmas.
if command -v qcc >/dev/null 2>&1; then
  ( cd "$tmp" && qcc -fopenmp -source swmm2d.c ) || true
  [ -s "$tmp/_swmm2d.c" ] || { echo "qcc -fopenmp -source failed" >&2; exit 1; }
  if ! grep -qE '_Pragma\("omp|#pragma omp' "$tmp/_swmm2d.c"; then
    # Some qcc versions leave OMP() for the C compiler; ensure it is not a no-op.
    if grep -qE '^#[[:space:]]*define[[:space:]]+OMP\(x\)[[:space:]]*$' "$tmp/_swmm2d.c"; then
      echo "qcc produced empty OMP(x) — OpenMP not enabled in generated source" >&2
      exit 1
    fi
  fi
  src="$tmp/_swmm2d.c"
else
  echo "qcc not found — using bin/_swmm2d.c with OpenMP preamble patch" >&2
  [ -s "$here/bin/_swmm2d.c" ] || { echo "missing bin/_swmm2d.c" >&2; exit 1; }
  python3 - "$here/bin/_swmm2d.c" "$tmp/_swmm2d.c" <<'PY'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8", errors="replace").read()
# Activate OMP macros when compiled with -fopenmp (_OPENMP defined).
text2, n1 = re.subn(
    r"(?m)^#\s*define\s+OMP\(x\)\s*$",
    "#if _OPENMP\n"
    "# include <omp.h>\n"
    "# define OMP(x) _Pragma(#x)\n"
    "#else\n"
    "# define OMP(x)\n"
    "#endif",
    text,
    count=1,
)
text3, n2 = re.subn(
    r"(?m)^#define tid\(\) 0\s*\n#define pid\(\) 0\s*\n#define npe\(\) 1\s*$",
    "#if _OPENMP\n"
    "#define tid() omp_get_thread_num()\n"
    "#define pid() 0\n"
    "#define npe() omp_get_num_threads()\n"
    "#else\n"
    "#define tid() 0\n"
    "#define pid() 0\n"
    "#define npe() 1\n"
    "#endif",
    text2,
    count=1,
)
if n1 != 1 or n2 != 1:
    raise SystemExit(f"OpenMP patch failed (OMP={n1}, tid/npe={n2})")
open(dst, "w", encoding="utf-8", newline="\n").write(text3)
print("patched OpenMP preamble OK")
PY
  src="$tmp/_swmm2d.c"
fi

cc=""
for cand in x86_64-w64-mingw32-gcc x86_64-w64-mingw32-gcc.exe mingw32-gcc gcc; do
  if command -v "$cand" >/dev/null 2>&1; then
    cc="$cand"
    break
  fi
done
[ -n "$cc" ] || { echo "need MinGW gcc (x86_64-w64-mingw32-gcc)" >&2; exit 1; }

mkdir -p "$here/bin"
"$cc" -O2 -fopenmp \
  -I "$here/winshim" -include "$here/winshim/wincompat.h" \
  -o "$here/bin/swmm2d-win64.exe" "$src" -lm -lgomp

cp "$src" "$here/bin/_swmm2d.c"
rm -f "$here/bin/swmm2d-win64.pdb"

# Bundle runtime DLLs next to the exe when the cross toolchain provides them.
for dll in libgomp-1.dll libwinpthread-1.dll libgcc_s_seh-1.dll; do
  dllpath="$("$cc" -print-file-name="$dll" 2>/dev/null || true)"
  if [ -n "$dllpath" ] && [ -f "$dllpath" ] && [ "$dllpath" != "$dll" ]; then
    cp -f "$dllpath" "$here/bin/$dll"
    echo "bundled $dll"
  fi
done

echo "built $here/bin/swmm2d-win64.exe (OpenMP via $cc)"
