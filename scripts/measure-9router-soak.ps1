param(
  [int]$Port = 20129,
  [int]$DurationMinutes = 120,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $OutputPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputPath = Join-Path $PSScriptRoot "..\reports\9router-soak-$stamp.csv"
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

$samples = [System.Collections.Generic.List[object]]::new()
$deadline = (Get-Date).AddMinutes($DurationMinutes)

do {
  $timestamp = Get-Date
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $process = if ($connection) { Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue } else { $null }
  $healthOk = $false
  $healthMs = $null
  if ($process) {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 10
      $healthOk = $health.ok -eq $true
    } catch {
      $healthOk = $false
    } finally {
      $stopwatch.Stop()
      $healthMs = $stopwatch.ElapsedMilliseconds
    }
  }

  $sample = [pscustomobject]@{
    Timestamp = $timestamp.ToString("o")
    Listening = [bool]$connection
    HealthOk = $healthOk
    HealthMs = $healthMs
    PID = if ($process) { $process.Id } else { $null }
    WorkingSetMB = if ($process) { [math]::Round($process.WorkingSet64 / 1MB, 1) } else { $null }
    PrivateMB = if ($process) { [math]::Round($process.PrivateMemorySize64 / 1MB, 1) } else { $null }
    Handles = if ($process) { $process.HandleCount } else { $null }
  }
  $samples.Add($sample)
  $sample | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Append

  if ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 60
  }
} while ((Get-Date) -lt $deadline)

$healthy = @($samples | Where-Object HealthOk)
$summary = [pscustomobject]@{
  OutputPath = (Resolve-Path -LiteralPath $OutputPath).Path
  Samples = $samples.Count
  HealthySamples = $healthy.Count
  FailedSamples = $samples.Count - $healthy.Count
  MinPrivateMB = if ($healthy) { ($healthy.PrivateMB | Measure-Object -Minimum).Minimum } else { $null }
  MaxPrivateMB = if ($healthy) { ($healthy.PrivateMB | Measure-Object -Maximum).Maximum } else { $null }
  MinWorkingSetMB = if ($healthy) { ($healthy.WorkingSetMB | Measure-Object -Minimum).Minimum } else { $null }
  MaxWorkingSetMB = if ($healthy) { ($healthy.WorkingSetMB | Measure-Object -Maximum).Maximum } else { $null }
  MinHandles = if ($healthy) { ($healthy.Handles | Measure-Object -Minimum).Minimum } else { $null }
  MaxHandles = if ($healthy) { ($healthy.Handles | Measure-Object -Maximum).Maximum } else { $null }
  MaxHealthMs = if ($healthy) { ($healthy.HealthMs | Measure-Object -Maximum).Maximum } else { $null }
}

$summary | ConvertTo-Json -Compress
if ($summary.FailedSamples -gt 0) { exit 1 }
