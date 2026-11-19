#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required. Install Docker and start it before running this script." >&2
    exit 1
fi

if ! docker compose -f "$root/compose.yaml" stop; then
    echo "Could not stop Kanban Studio. Check Docker's error output above." >&2
    exit 1
fi

echo "Kanban Studio stopped. Persistent data was retained."
