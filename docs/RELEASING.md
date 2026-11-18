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
git push                                 # to main, directly or by merging a pull request
```

That's all. When a commit that changes `VERSION` reaches `main`, the **Release** workflow:

1. checks the version numbers agree and that CHANGELOG.md has notes for the version,
2. runs the backend tests on Windows,
3. builds `Saturday-SWMM-0.3.0-win64.zip` with `packaging/windows/build_portable.ps1`, starts the
   packaged app and runs the sample model with OpenSWMM and EPA SWMM 5,
4. publishes GitHub release `v0.3.0` (creating the tag on that commit) with the zip, its
   `.sha256`, and that version's CHANGELOG section as the notes.

If any step fails, nothing is published; fix it and push again. A push that touches `VERSION`
for a version that's already released does nothing. The website's Download button and the app's
update check pick up the new release automatically.

Pushing a `vX.Y.Z` tag yourself still works too and does the same thing.

To test the packaging without releasing: **Actions → Release → Run workflow** (keeps the zip as a
run artifact only), or run the script locally on Windows:

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
