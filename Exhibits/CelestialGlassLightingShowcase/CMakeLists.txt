cmake_minimum_required(VERSION 3.20)
project(FrontierCelestialGlassLightingShowcase LANGUAGES CXX)

set(FRONTIER_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Threading"   "${CMAKE_CURRENT_BINARY_DIR}/engine-threading")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Audio"       "${CMAKE_CURRENT_BINARY_DIR}/engine-audio")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Networking"  "${CMAKE_CURRENT_BINARY_DIR}/engine-networking")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Physics"     "${CMAKE_CURRENT_BINARY_DIR}/engine-physics")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/GeometryProcessing"    "${CMAKE_CURRENT_BINARY_DIR}/engine-geometry")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/VisualEffects" "${CMAKE_CURRENT_BINARY_DIR}/engine-environment")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Rendering"   "${CMAKE_CURRENT_BINARY_DIR}/engine-rendering")

add_executable(CelestialGlassLightingShowcase
    Code/CelestialGlassLightingShowcase.cpp)

target_compile_features(CelestialGlassLightingShowcase PRIVATE cxx_std_20)
target_include_directories(CelestialGlassLightingShowcase PRIVATE
    "${FRONTIER_REPO_ROOT}/Frontier")

target_link_libraries(CelestialGlassLightingShowcase PRIVATE
    FrontierGeometryProcessing
    FrontierCelestialSky
    FrontierSceneRenderer
    FrontierPlumeFluid
    FrontierShallowWater
    FrontierSnowLightning
    FrontierParticles
    FrontierAtmosphericOptics)

if(MSVC)
    target_compile_options(CelestialGlassLightingShowcase PRIVATE /utf-8 /W4)
else()
    target_compile_options(CelestialGlassLightingShowcase PRIVATE -Wall -Wextra -Werror)
endif()
