# PyInstaller spec for the desktop app. Build with:  python build_desktop.py
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None
ROOT = "D:/working/Projects/Quora Profile Search"

a = Analysis(
    ["desktop.py"],
    pathex=["."],
    datas=[(f"{ROOT}/frontend/dist", "frontend/dist")],
    hiddenimports=[*collect_submodules("uvicorn"), *collect_submodules("app"), "webview.platforms.edgechromium",
                   "webview.platforms.winforms"],
    excludes=["celery", "kombu", "redis", "psycopg", "pytest", "tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="ContactDiscovery", console=False, upx=False)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, upx=False, name="ContactDiscovery")
