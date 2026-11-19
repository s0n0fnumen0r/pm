$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required. Install Docker Desktop and start it before running this script."
}

docker compose -f (Join-Path $root "compose.yaml") up --build -d
if ($LASTEXITCODE -ne 0) {
    throw "Could not start Kanban Studio. Check Docker's error output above."
}

Write-Host "Kanban Studio is starting at http://127.0.0.1:8765"
