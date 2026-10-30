cmake_minimum_required(VERSION 3.20)
project(FrontierEngineSystemsValidation LANGUAGES CXX)

set(FRONTIER_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Threading" "${CMAKE_CURRENT_BINARY_DIR}/engine-threading")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Audio"     "${CMAKE_CURRENT_BINARY_DIR}/engine-audio")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Networking" "${CMAKE_CURRENT_BINARY_DIR}/engine-networking")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Physics"   "${CMAKE_CURRENT_BINARY_DIR}/engine-physics")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Rendering" "${CMAKE_CURRENT_BINARY_DIR}/engine-rendering")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Projects/Project-Drive" "${CMAKE_CURRENT_BINARY_DIR}/project-drive")

add_executable(EngineSystemsValidation
    Code/EngineSystemsValidation.cpp
    "${FRONTIER_REPO_ROOT}/Frontier/Engine/Physics/TyreThermalSolver.cpp")

target_compile_features(EngineSystemsValidation PRIVATE cxx_std_20)
target_include_directories(EngineSystemsValidation PRIVATE
    "${FRONTIER_REPO_ROOT}/Frontier"
    "${FRONTIER_REPO_ROOT}/Frontier/Projects/Project-Networking/Source")

target_link_libraries(EngineSystemsValidation PRIVATE
    FrontierPropulsion
    FrontierWindField
    FrontierFrameGraphRuntime
    FrontierNetworking
    FrontierAudioFoundation
    ProjectDriveSimulation)

if(MSVC)
    target_compile_options(EngineSystemsValidation PRIVATE /utf-8 /W4)
else()
    target_compile_options(EngineSystemsValidation PRIVATE -Wall -Wextra -Werror)
endif()
