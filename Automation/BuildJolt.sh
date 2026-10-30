#!/usr/bin/env bash
#============================================================================================================================================
#                                                            BUILDJOLT.SH
#============================================================================================================================================
# 🧩 Fetches pinned Jolt Physics v5.6.0 into ExternalPackages/jolt (gitignored) and compiles libJolt.a with exact ABI/ISA flag parity.
#
#    bash Automation/BuildJolt.sh               # Release   -> ExternalPackages/jolt/lib/Release/libJolt.a
#    bash Automation/BuildJolt.sh debug         # Debug     -> ExternalPackages/jolt/lib/Debug/libJolt.a
#    bash Automation/BuildJolt.sh sanitized     # Sanitized -> ExternalPackages/jolt/lib/Sanitized/libJolt.a
#    bash Automation/BuildJolt.sh --rebuild

set -euo pipefail

Configuration='Release'
Rebuild=0
for Argument in "$@"
do
    case "$Argument" in
        debug|Debug)         Configuration='Debug' ;;
        release|Release)     Configuration='Release' ;;
        sanitized|Sanitized) Configuration='Sanitized' ;;
        --rebuild)           Rebuild=1 ;;
        *) echo "[FAILED]   unknown argument '$Argument'" >&2; exit 1 ;;
    esac
done

ScriptRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RepositoryRoot="$(cd "$ScriptRoot/.." && pwd)"
JoltVersion='5.6.0'
JoltRoot="${FRONTIER_JOLT_ROOT:-$RepositoryRoot/ExternalPackages/jolt}"
BuildRoot="$JoltRoot/_build/$Configuration"
OutputRoot="$JoltRoot/lib/$Configuration"
Archive="$OutputRoot/libJolt.a"

CXX="${CXX:-g++}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"

report() { printf '%-10s %s\n' "[$1]" "$2"; }

if [ ! -f "$JoltRoot/Jolt/Jolt.h" ]
then
    report 'Fetch' "Jolt Physics v$JoltVersion -> $JoltRoot"
    mkdir -p "$JoltRoot"
    Tarball="$JoltRoot/jolt-v$JoltVersion.tar.gz"
    curl -fsSL "https://codeload.github.com/jrouwe/JoltPhysics/tar.gz/refs/tags/v$JoltVersion" -o "$Tarball"
    tar -xzf "$Tarball" --strip-components=1 -C "$JoltRoot"
    rm -rf "$Tarball" "$JoltRoot/Assets" "$JoltRoot/Docs" "$JoltRoot/Samples" \
           "$JoltRoot/UnitTests" "$JoltRoot/PerformanceTest" "$JoltRoot/TestFramework"
fi

if [ "$Rebuild" -eq 0 ] && [ -f "$Archive" ]
then
    report 'SKIP' "Jolt ($Configuration) archive present - $Archive"
    exit 0
fi

if [ "$Rebuild" -eq 1 ]
then
    rm -rf "$BuildRoot" "$Archive"
fi
mkdir -p "$BuildRoot" "$OutputRoot"

#------------------------------------------------------------------------------------------------------------------------
#                                    FLAGS  (keep identical to FrontierRigidBodyPhysics)
#------------------------------------------------------------------------------------------------------------------------
ArchFlags=()
case "$(uname -m)" in
    x86_64|amd64) ArchFlags=(-mavx -mpopcnt -mfpmath=sse) ;;
esac

CommonFlags=(
    -std=c++20
    -c
    "${ArchFlags[@]}"
    -fPIC
    -pthread
    -Wall
    -Wno-psabi
    -Wno-stringop-overflow
    "-I$JoltRoot"
)

if [ "$Configuration" = 'Debug' ]
then
    Flags=("${CommonFlags[@]}" -O0 -g)
elif [ "$Configuration" = 'Sanitized' ]
then
    Flags=("${CommonFlags[@]}" -O1 -g1 -fno-omit-frame-pointer -fsanitize=address,undefined -DNDEBUG)
else
    Flags=("${CommonFlags[@]}" -O2 -DNDEBUG)
fi

#------------------------------------------------------------------------------------------------------------------------
#                                                        SOURCES
#------------------------------------------------------------------------------------------------------------------------
mapfile -t Sources < <(find "$JoltRoot/Jolt" -name '*.cpp' \
    -not -path '*/Compute/CPU/*'  \
    -not -path '*/Compute/DX12/*' \
    -not -path '*/Compute/VK/*'   \
    -not -path '*/Compute/MTL/*'  \
    -not -name 'HairWrapper.cpp'  \
    -not -name 'TestComputeWrapper.cpp' | sort)

if [ "${#Sources[@]}" -eq 0 ]
then
    report 'FAILED' "no Jolt sources found under $JoltRoot/Jolt"
    exit 1
fi

#------------------------------------------------------------------------------------------------------------------------
#                                                      COMPILATION
#------------------------------------------------------------------------------------------------------------------------
Stale=()
Objects=()
for Source in "${Sources[@]}"
do
    Stem="$(basename "$Source" .cpp)"
    Object="$BuildRoot/$Stem.o"
    Objects+=("$Object")
    if [ ! -f "$Object" ] || [ "$Source" -nt "$Object" ]
    then
        Stale+=("$Source")
    fi
done

if [ "${#Stale[@]}" -eq 0 ] && [ -f "$Archive" ]
then
    report 'SKIP' "Jolt ($Configuration) unchanged - $Archive"
    exit 0
fi

report 'Build' "Jolt v$JoltVersion ($Configuration) - translating ${#Stale[@]} of ${#Sources[@]} units with $CXX, $JOBS jobs"

export CXX BuildRoot
FlagsSerialised="$(printf '%q ' "${Flags[@]}")"
export FlagsSerialised

if [ "${#Stale[@]}" -gt 0 ]
then
    printf '%s\0' "${Stale[@]}" | xargs -0 -n 1 -P "$JOBS" bash -c '
        eval "Flags=($FlagsSerialised)"
        Stem="$(basename "$0" .cpp)"
        if ! "$CXX" "${Flags[@]}" -o "$BuildRoot/$Stem.o" "$0"
        then
            echo "[FAILED]   $0" >&2
            exit 255
        fi
    '
fi

#------------------------------------------------------------------------------------------------------------------------
#                                                       ARCHIVING
#------------------------------------------------------------------------------------------------------------------------
report 'Build' "Jolt ($Configuration) - archiving libJolt.a"
rm -f "$Archive"
ar rcs "$Archive" "${Objects[@]}"
rm -rf "$BuildRoot"
report 'Compiled' "$Archive"
