#============================================================================================================================================
#                                                        BUILDJOLTWINDOWS.PY
#============================================================================================================================================
# 🧩 Fetches pinned Jolt Physics v5.6.0 into ExternalPackages/jolt and compiles Jolt.lib on Windows MSVC with exact
#    FrontierRigidBodyPhysics ABI parity (/std:c++20 /O2 /MD /arch:AVX /utf-8 /DNDEBUG, zero extra JPH_* defines).

from pathlib import Path
import io
import shutil
import subprocess
import sys
import tarfile
import urllib.request

RepoRoot = Path(__file__).resolve().parents[1]
JoltRoot = RepoRoot / "ExternalPackages/jolt"
OutLib   = JoltRoot / "lib/Release/Jolt.lib"


def Main() -> int:
    if not (JoltRoot / "Jolt/Jolt.h").exists():
        print("[Fetch] Jolt Physics v5.6.0 ->", JoltRoot)
        Url = "https://codeload.github.com/jrouwe/JoltPhysics/tar.gz/refs/tags/v5.6.0"
        with urllib.request.urlopen(Url, timeout=120) as Resp:
            Data = Resp.read()
        Staging = RepoRoot / "_ClaudeScratch/jolt-win-dl"
        if Staging.exists():
            shutil.rmtree(Staging)
        Staging.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(Data), mode="r:gz") as Tar:
            for Member in Tar.getmembers():
                Parts = Path(Member.name).parts[1:]
                if not Parts or Parts[0] != "Jolt":
                    continue
                Dest = JoltRoot.joinpath(*Parts)
                if Member.isdir():
                    Dest.mkdir(parents=True, exist_ok=True)
                elif Member.isfile():
                    Dest.parent.mkdir(parents=True, exist_ok=True)
                    with Tar.extractfile(Member) as Src, Dest.open("wb") as Dst:
                        shutil.copyfileobj(Src, Dst)
        shutil.rmtree(Staging, ignore_errors=True)

    if OutLib.exists():
        print("[SKIP] Jolt.lib already built:", OutLib)
        return 0

    def KeepJoltUnit(p: Path) -> bool:
        posix = p.as_posix()
        if any(seg in posix for seg in ("/Compute/CPU/", "/Compute/DX12/", "/Compute/VK/", "/Compute/MTL/")):
            return False
        if p.name in ("HairWrapper.cpp", "TestComputeWrapper.cpp"):
            return False
        return True

    Sources = sorted(
        p.relative_to(JoltRoot).as_posix()
        for p in (JoltRoot / "Jolt").rglob("*.cpp")
        if KeepJoltUnit(p)
    )
    BuildDir = JoltRoot / "_build_msvc"
    BuildDir.mkdir(parents=True, exist_ok=True)
    CmakeTxt = BuildDir / "CMakeLists.txt"
    SrcList  = "\n    ".join(f'"{ (JoltRoot / s).as_posix() }"' for s in Sources)
    CmakeTxt.write_text(f"""cmake_minimum_required(VERSION 3.20)
project(JoltMsvc LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_library(Jolt STATIC
    {SrcList}
)
target_include_directories(Jolt PUBLIC "{JoltRoot.as_posix()}")
target_compile_options(Jolt PRIVATE /utf-8 /O2 /MD /arch:AVX /EHsc)
target_compile_definitions(Jolt PRIVATE NDEBUG)
set_target_properties(Jolt PROPERTIES
    ARCHIVE_OUTPUT_DIRECTORY "{OutLib.parent.as_posix()}"
    ARCHIVE_OUTPUT_DIRECTORY_RELEASE "{OutLib.parent.as_posix()}"
    OUTPUT_NAME "Jolt")
""")

    subprocess.run(["cmake", "-S", str(BuildDir), "-B", str(BuildDir / "out"), "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release"], check=True)
    subprocess.run(["cmake", "--build", str(BuildDir / "out"), "--config", "Release"], check=True)
    if not OutLib.exists():
        raise RuntimeError(f"Expected {OutLib} was not produced")
    print("[PASS] Built", OutLib, f"({OutLib.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(Main())
