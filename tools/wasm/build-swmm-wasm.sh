#!/usr/bin/env bash
# Build EPA SWMM 5.2.4 as WebAssembly (WASI) for the browser viewer.
# Needs: git, python3 with `pip install ziglang`. Output: frontend/src/viewer/engine/swmm5.wasm
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../frontend/src/viewer/engine/swmm5.wasm"
WORK="$(mktemp -d)"
git clone -q --depth 1 --branch v5.2.4 https://github.com/USEPA/Stormwater-Management-Model.git "$WORK/swmm"
# WASI has no mkstemp(): name temp files with a counter instead.
python3 - "$WORK/swmm/src/solver/swmm5.c" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '    sstrncpy(fname, "swmmXXXXXX", MAXFNAME);\n    mkstemp(fname);\n    return fname;'
new = ('#ifdef __wasi__\n    {\n        static int wasiTmpCount = 0;\n'
       '        snprintf(fname, MAXFNAME, "swmm%06d.tmp", ++wasiTmpCount);\n    }\n#else\n'
       '    sstrncpy(fname, "swmmXXXXXX", MAXFNAME);\n    mkstemp(fname);\n#endif\n    return fname;')
assert old in s, "swmm5.c changed upstream; update the patch"
open(p, "w").write(s.replace(old, new))
PY
python3 -m ziglang cc -target wasm32-wasi -O2 \
  -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS \
  -lwasi-emulated-process-clocks -lwasi-emulated-signal \
  -I"$WORK/swmm/src/solver" -I"$WORK/swmm/src/solver/include" \
  "$WORK"/swmm/src/solver/*.c "$WORK/swmm/src/run/main.c" -lm -o "$OUT"
rm -rf "$WORK"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
