# Start Saturday-SWMM backend (:8000) and frontend (:5173) in two windows.
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Uvicorn = Join-Path $Backend ".venv\Scripts\uvicorn.exe"

if (-not (Test-Path $Uvicorn)) {
  Write-Host "Missing backend venv uvicorn at: $Uvicorn" -ForegroundColor Red
  Write-Host "Create it with:"
  Write-Host "  cd backend; python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt"
  exit 1
}

if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
  Write-Host "frontend/node_modules missing - run: cd frontend; npm install" -ForegroundColor Yellow
}

Write-Host "Starting Saturday-SWMM..." -ForegroundColor Cyan
Write-Host "  Backend  http://127.0.0.1:8000"
Write-Host "  Frontend http://localhost:5173"
Write-Host "Stop with .\stop-dev.ps1 (or Cursor task Saturday-SWMM: Stop)"

$backendLine = "Set-Location -LiteralPath '$Backend'; Write-Host 'Saturday-SWMM backend (Ctrl+C to stop)' -ForegroundColor Cyan; & '$Uvicorn' app.main:app --reload --host 127.0.0.1 --port 8000"
$frontendLine = "Set-Location -LiteralPath '$Frontend'; Write-Host 'Saturday-SWMM frontend (Ctrl+C to stop)' -ForegroundColor Cyan; npm run dev"

Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-NoProfile", "-Command", $backendLine
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-NoProfile", "-Command", $frontendLine

Start-Sleep -Seconds 2
try {
  Start-Process "http://localhost:5173"
} catch {
  # ignore
}

Write-Host "Launched. Leave the two PowerShell windows open while you work." -ForegroundColor Green
