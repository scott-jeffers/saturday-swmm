<#
.SYNOPSIS
  Stop Saturday-SWMM dev servers listening on ports 8000 (API) and 5280 (Vite).

.DESCRIPTION
  Only targets those listeners — does not kill unrelated Python processes.
#>
$ErrorActionPreference = "Continue"
$Ports = @(8000, 5280)
$killed = @{}

function Stop-ListenerOnPort([int]$Port) {
  $pids = @()
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
      $pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
    }
  } catch {
    # Fallback for environments without Get-NetTCPConnection
  }

  if (-not $pids -or $pids.Count -eq 0) {
    $lines = netstat -ano | Select-String ":$Port\s+.*LISTENING"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
      if ($parts.Count -ge 5) {
        $pids += [int]$parts[-1]
      }
    }
    $pids = $pids | Select-Object -Unique
  }

  foreach ($procId in $pids) {
    if (-not $procId -or $procId -le 0) { continue }
    if ($killed.ContainsKey($procId)) { continue }
    try {
      $p = Get-Process -Id $procId -ErrorAction Stop
      Write-Host "Stopping PID $procId ($($p.ProcessName)) on port $Port"
      Stop-Process -Id $procId -Force -ErrorAction Stop
      $killed[$procId] = $true
    } catch {
      Write-Host "Could not stop PID $procId : $_" -ForegroundColor Yellow
    }
  }
}

Write-Host "Stopping Saturday-SWMM listeners on ports $($Ports -join ', ')…" -ForegroundColor Cyan
foreach ($port in $Ports) {
  Stop-ListenerOnPort $port
}

# Also stop orphaned uvicorn / reload workers (can keep port 8000 busy without a live listener PID).
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like '*app.main:app*' -or
    $_.CommandLine -like '*spawn_main(parent_pid=*'
  } |
  ForEach-Object {
    $procId = [int]$_.ProcessId
    if ($procId -le 0 -or $killed.ContainsKey($procId)) { return }
    try {
      Write-Host "Stopping related PID $procId ($($_.Name))"
      Stop-Process -Id $procId -Force -ErrorAction Stop
      $killed[$procId] = $true
    } catch {
      Write-Host "Could not stop PID $procId : $_" -ForegroundColor Yellow
    }
  }

if ($killed.Count -eq 0) {
  Write-Host "Nothing was listening on 8000 or 5280." -ForegroundColor Yellow
} else {
  Write-Host "Done. Stopped $($killed.Count) process(es)." -ForegroundColor Green
}
