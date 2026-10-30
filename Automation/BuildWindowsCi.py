#============================================================================================================================================
#                                                        BUILDWINDOWSCI.PY
#============================================================================================================================================
# 🧩 Runs the Windows x64 MSVC build, Shipping + Win32 DirectX 11 smoke checks, and ProjectDrive-windows-x86_64.zip
#    packaging with GitHub Actions ::error:: annotation reporting on any non-zero step exit.

import pathlib
import shutil
import subprocess
import sys
import zipfile


def Main() -> int:
    JoltLib = (pathlib.Path.cwd() / "ExternalPackages/jolt/lib/Release/Jolt.lib").as_posix()
    Steps = [
        [sys.executable, "Automation/BuildJoltWindows.py"],
        [
            "cmake", "-S", "Frontier/Projects/Project-Drive", "-B", "build-win-editor",
            "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release", f"-DFRONTIER_JOLT_LIBRARY={JoltLib}",
        ],
        ["cmake", "--build", "build-win-editor", "--config", "Release"],
        [
            "cmake", "-S", "Frontier/Projects/Project-Drive", "-B", "build-win-shipping",
            "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release", "-DFRONTIER_PROJECT_DRIVE_SHIPPING=ON",
            f"-DFRONTIER_JOLT_LIBRARY={JoltLib}",
        ],
        ["cmake", "--build", "build-win-shipping", "--config", "Release"],
        ["build-win-shipping/Shipping/ProjectDriveShipping.exe", "--project-root", "Frontier/Projects/Project-Drive"],
        [
            "Frontier/Projects/Project-Drive/Binaries/ProjectDrive.exe",
            "--project-root", "Frontier/Projects/Project-Drive", "--smoke-frames", "6",
        ],
    ]
    for Cmd in Steps:
        print("==> RUNNING:", " ".join(Cmd), flush=True)
        Proc = subprocess.run(Cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
        print(Proc.stdout, flush=True)
        if Proc.returncode != 0:
            Lines = [Ln for Ln in Proc.stdout.splitlines() if Ln.strip()][-35:]
            Msg   = "\n".join(Lines).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print(f"::error title=WindowsStepFailed::{Msg}", flush=True)
            return Proc.returncode

    Dist = pathlib.Path("dist")
    if Dist.exists():
        shutil.rmtree(Dist)
    (Dist / "ProjectDrive/Binaries").mkdir(parents=True, exist_ok=True)
    (Dist / "EngineContent").mkdir(parents=True, exist_ok=True)

    shutil.copy2("Frontier/Projects/Project-Drive/Binaries/ProjectDrive.exe", Dist / "ProjectDrive/Binaries/ProjectDrive.exe")
    shutil.copy2("build-win-shipping/Shipping/ProjectDriveShipping.exe", Dist / "ProjectDrive/Binaries/ProjectDriveShipping.exe")
    shutil.copy2("Frontier/Projects/Project-Drive/ProjectDrive.frontier", Dist / "ProjectDrive/ProjectDrive.frontier")
    shutil.copytree("Frontier/Projects/Project-Drive/Geometry", Dist / "ProjectDrive/Geometry")
    shutil.copytree("EngineContent/FontArchives", Dist / "EngineContent/FontArchives")
    shutil.copytree("EngineContent/Icons", Dist / "EngineContent/Icons")

    (Dist / "README.txt").write_text(
        "Frontier Engine - Project-Drive (Windows 10/11 x64, DirectX 11, Zero External DLLs)\n"
        "====================================================================================\n"
        "1. Extract all files keeping the ProjectDrive/ and EngineContent/ folders side-by-side.\n"
        "2. Double-click ProjectDrive\\Binaries\\ProjectDrive.exe to launch the 1:1 Dark OLED\n"
        "   VehicleHMI Proving Grounds + ReSTIR GI + Dedicated Entity Studios desktop app!\n"
        "3. Double-click (or click the popup icon on) any entity in the Outliner to open its\n"
        "   zero-copy Shared-Memory Dedicated Studio window (Pyro Plume, Fracture, 3D Object, etc.).\n",
        encoding="utf-8",
    )

    ZipPath = pathlib.Path("ProjectDrive-windows-x86_64.zip")
    with zipfile.ZipFile(ZipPath, "w", compression=zipfile.ZIP_DEFLATED) as Zf:
        for FilePath in sorted(Dist.rglob("*")):
            if FilePath.is_file():
                Zf.write(FilePath, FilePath.relative_to(Dist).as_posix())

    print(f"[PASS] Packaged {ZipPath} ({ZipPath.stat().st_size} bytes)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(Main())
