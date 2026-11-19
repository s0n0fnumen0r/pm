# Scripts

- `start.ps1` and `stop.ps1` control the Compose app on Windows.
- `start.sh` and `stop.sh` provide the same commands for macOS and Linux; run them with `sh`.
- Scripts resolve `compose.yaml` relative to their own location. Start builds and starts the app; stop retains its persistent volume.
- Docker and the Compose plugin must be installed and the Docker daemon must be running.
