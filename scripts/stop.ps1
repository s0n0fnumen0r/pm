$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required. Install Docker Desktop and start it before running this script."
}

docker compose -f (Join-Path $root "compose.yaml") stop
if ($LASTEXITCODE -ne 0) {
    throw "Could not stop Kanban Studio. Check Docker's error output above."
}

Write-Host "Kanban Studio stopped. Persistent data was retained."
