#============================================================================================================================================
#                                                        BUILDWINDOWSCI.PY
#============================================================================================================================================
# 🧩 Runs the Windows x64 MSVC build + smoke checks for ProjectDrive.exe & ProjectDriveShipping.exe with
#    GitHub Actions ::error:: annotation reporting on any non-zero step exit.

import pathlib
import subprocess
import sys


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
    return 0


if __name__ == "__main__":
    sys.exit(Main())
