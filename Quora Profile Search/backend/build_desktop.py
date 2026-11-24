"""Build the Windows desktop app.

    cd backend
    .venv\\Scripts\\python build_desktop.py

Output: backend/dist/ContactDiscovery/ContactDiscovery.exe (plus a Desktop shortcut on Windows).
"""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def run(cmd: list[str], cwd: Path) -> None:
    print("›", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, shell=(os.name == "nt" and cmd[0] == "npm"))


def main() -> None:
    run(["npm", "run", "build"], ROOT / "frontend")
    spec = (HERE / "ContactDiscovery.spec").read_text(encoding="utf-8")
    spec = spec.replace('ROOT = "D:/working/Projects/Quora Profile Search"', f'ROOT = "{ROOT.as_posix()}"')
    (HERE / "ContactDiscovery.spec").write_text(spec, encoding="utf-8")
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "ContactDiscovery.spec"], HERE)
    exe = HERE / "dist" / "ContactDiscovery" / "ContactDiscovery.exe"
    print(f"\nBuilt {exe}")
    if os.name == "nt":
        desktop = Path(os.environ.get("USERPROFILE", "~")).expanduser() / "Desktop" / "Contact Discovery.lnk"
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{desktop}');"
              f"$s.TargetPath='{exe}';$s.WorkingDirectory='{exe.parent}';$s.Save()")
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=False)
        print(f"Shortcut: {desktop}")


if __name__ == "__main__":
    main()
