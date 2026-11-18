# Releasing

Saturday-SWMM ships as a portable Windows zip built by GitHub Actions. A release is fully
determined by its git tag: the code at the tag, the Python dependency lock, and the npm lockfile.

## Version numbers

- [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, pre-releases like `0.3.0-beta.1`
  (published as GitHub pre-releases).
- The version is recorded in `VERSION`, `frontend/package.json` (+ lock) and
  `backend/pyproject.toml`. `scripts/check_version.py` fails CI if they differ; never edit them by
  hand — use the bump script.

## Cut a release

```powershell
python scripts/bump_version.py 0.3.0     # updates all version files + adds a CHANGELOG section
# edit CHANGELOG.md: describe what changed for users
git commit -am "Release v0.3.0"
git tag v0.3.0
git push --follow-tags
```

The **Release** workflow then tests the backend on Windows, builds
`Saturday-SWMM-0.3.0-win64.zip` (+ `.sha256`) with `packaging/windows/build_portable.ps1`, and
publishes a GitHub release using that version's CHANGELOG section as release notes. Running apps
see the new release through **About → Check for updates**.

To test the packaging without releasing: **Actions → Release → Run workflow** (uploads the zip as a
build artifact only), or run the script locally on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build_portable.ps1
```

## Dependencies

- `backend/requirements.txt` — minimum versions (for source installs and CI).
- `backend/requirements-windows.lock` — the exact, hash-pinned set the release installs. After
  changing `requirements.txt`, regenerate it (the command is at the top of the file) and commit it
  in the same change.
- `frontend/package-lock.json` — exact npm set (`npm ci` in CI and the build).
- The embeddable CPython version is pinned in `build_portable.ps1` (`-PythonVersion`).

## Branches

- `main` is always releasable; CI (tests, type-check, build, version check) must pass.
- Work happens on feature branches merged by pull request.
- Hot-fixes: branch from the release tag, bump PATCH, tag.
