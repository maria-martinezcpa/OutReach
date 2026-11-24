# Rebuilds the desktop app into app\GitHubProfileFinder\GitHubProfileFinder.exe
# Keeps the existing data folder and .env next to the program.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Push-Location "$root\frontend"
if (-not (Test-Path node_modules)) { npm ci }
npm run build
Pop-Location

Push-Location "$root\backend"
if (-not (Test-Path venv)) {
    python -m venv venv
    .\venv\Scripts\python -m pip install -r requirements.txt pywebview pyinstaller
}
$out = "$root\app\GitHubProfileFinder"
$keep = "$root\build\keep"
if (Test-Path "$out\data") { New-Item -ItemType Directory -Force $keep | Out-Null; Move-Item "$out\data" "$keep\data" -Force }
if (Test-Path "$out\.env") { New-Item -ItemType Directory -Force $keep | Out-Null; Move-Item "$out\.env" "$keep\.env" -Force }

.\venv\Scripts\pyinstaller --noconfirm --clean --windowed --name GitHubProfileFinder `
    --distpath "$root\app" --workpath "$root\build\pyinstaller" --specpath "$root\build" `
    --add-data "$root\frontend\dist;frontend_dist" `
    --collect-submodules uvicorn --collect-data pycountry --collect-submodules app desktop.py
Pop-Location

if (Test-Path "$keep\data") { Move-Item "$keep\data" "$out\data" -Force }
if (Test-Path "$keep\.env") { Move-Item "$keep\.env" "$out\.env" -Force }
Write-Host "Built $out\GitHubProfileFinder.exe"
