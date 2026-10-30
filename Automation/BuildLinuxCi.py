#============================================================================================================================================
#                                                         BUILDLINUXCI.PY
#============================================================================================================================================
# 🧩 Runs the Linux x86_64 CI build, Shipping smoke test, and portable ProjectDrive-linux-x86_64.zip packaging
#    (preserving +x executable mode bits) with GitHub Actions ::error:: annotation reporting on any failure.

import os
import pathlib
import shutil
import stat
import subprocess
import sys
import traceback
import zipfile


def EmitError(Title: str, Text: str) -> None:
    Msg = Text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title={Title}::{Msg[:3500]}", flush=True)


def RunStep(Cmd: list[str]) -> None:
    print("==> RUNNING:", " ".join(Cmd), flush=True)
    Proc = subprocess.run(Cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    print(Proc.stdout, flush=True)
    if Proc.returncode != 0:
        ErrLines = [Ln for Ln in Proc.stdout.splitlines() if Ln.strip() and not Ln.startswith("[")]
        if not ErrLines:
            ErrLines = [Ln for Ln in Proc.stdout.splitlines() if Ln.strip()]
        EmitError("LinuxStepFailed", "\n".join(ErrLines[-35:]))
        sys.exit(Proc.returncode)


def Main() -> int:
    try:
        Steps = [
            [sys.executable, "-m", "pip", "install", "-r", "Automation/FontRequirements.txt"],
            [sys.executable, "Automation/PrepareUI.py"],
            [sys.executable, "Automation/PrepareFonts.py"],
            ["bash", "Automation/BuildJolt.sh"],
            [
                "cmake", "-S", "Frontier/Projects/Project-Drive", "-B", "build-editor",
                "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release", "-DFRONTIER_CI_RELAX_WERROR=ON",
            ],
            ["cmake", "--build", "build-editor", "--config", "Release", "-j", "4"],
            [
                "cmake", "-S", "Frontier/Projects/Project-Drive", "-B", "build-shipping",
                "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release", "-DFRONTIER_PROJECT_DRIVE_SHIPPING=ON",
                "-DFRONTIER_CI_RELAX_WERROR=ON",
            ],
            ["cmake", "--build", "build-shipping", "--config", "Release", "-j", "4"],
            ["./build-shipping/Shipping/ProjectDriveShipping", "--project-root", "Frontier/Projects/Project-Drive"],
        ]
        for Cmd in Steps:
            RunStep(Cmd)

        Dist = pathlib.Path("dist")
        if Dist.exists():
            shutil.rmtree(Dist)
        (Dist / "ProjectDrive/Binaries").mkdir(parents=True, exist_ok=True)
        (Dist / "EngineContent").mkdir(parents=True, exist_ok=True)

        shutil.copy2("Frontier/Projects/Project-Drive/Binaries/ProjectDrive", Dist / "ProjectDrive/Binaries/ProjectDrive")
        shutil.copy2("build-shipping/Shipping/ProjectDriveShipping", Dist / "ProjectDrive/Binaries/ProjectDriveShipping")
        os.chmod(Dist / "ProjectDrive/Binaries/ProjectDrive", 0o755)
        os.chmod(Dist / "ProjectDrive/Binaries/ProjectDriveShipping", 0o755)
        shutil.copy2("Frontier/Projects/Project-Drive/ProjectDrive.frontier", Dist / "ProjectDrive/ProjectDrive.frontier")
        shutil.copy2("Frontier/Projects/Project-Drive/ContentManifest.toml", Dist / "ProjectDrive/ContentManifest.toml")
        shutil.copytree("Frontier/Projects/Project-Drive/Content", Dist / "ProjectDrive/Content")
        shutil.copytree("EngineContent/FontArchives", Dist / "EngineContent/FontArchives")
        shutil.copytree("EngineContent/Icons", Dist / "EngineContent/Icons")

        (Dist / "README.txt").write_text(
            "Frontier Engine - Project-Drive (Linux x86_64)\n"
            "==============================================\n"
            "1. Interactive Browser UI + Live 3D Viewport:\n"
            "   ./ProjectDrive/Binaries/ProjectDrive --serve 5174\n"
            "   Then open http://127.0.0.1:5174 in any browser.\n\n"
            "2. Automated 10-Shot Verification & Captures:\n"
            "   ./ProjectDrive/Binaries/ProjectDrive --verify-and-capture ./Captures\n\n"
            "3. Zero-Editor Shipping Runtime:\n"
            "   ./ProjectDrive/Binaries/ProjectDriveShipping\n",
            encoding="utf-8",
        )

        ZipPath = pathlib.Path("ProjectDrive-linux-x86_64.zip")
        with zipfile.ZipFile(ZipPath, "w", compression=zipfile.ZIP_DEFLATED) as Zf:
            for FilePath in sorted(Dist.rglob("*")):
                if not FilePath.is_file():
                    continue
                Rel  = FilePath.relative_to(Dist).as_posix()
                Info = zipfile.ZipInfo(Rel)
                Mode = 0o755 if FilePath.parent.name == "Binaries" else 0o644
                Info.external_attr = (stat.S_IFREG | Mode) << 16
                Info.compress_type = zipfile.ZIP_DEFLATED
                Zf.writestr(Info, FilePath.read_bytes())

        print(f"[PASS] Packaged {ZipPath} ({ZipPath.stat().st_size} bytes)", flush=True)
        return 0
    except Exception:
        EmitError("LinuxPackagingFailed", traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(Main())
