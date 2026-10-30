cmake_minimum_required(VERSION 3.20)
project(FrontierWorldSimulationAndSdfValidation LANGUAGES CXX)

set(FRONTIER_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Threading"  "${CMAKE_CURRENT_BINARY_DIR}/engine-threading")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Audio"      "${CMAKE_CURRENT_BINARY_DIR}/engine-audio")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Networking" "${CMAKE_CURRENT_BINARY_DIR}/engine-networking")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Physics"    "${CMAKE_CURRENT_BINARY_DIR}/engine-physics")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Rendering"  "${CMAKE_CURRENT_BINARY_DIR}/engine-rendering")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Engine/Interface"  "${CMAKE_CURRENT_BINARY_DIR}/engine-interface")
add_subdirectory("${FRONTIER_REPO_ROOT}/Frontier/Projects/Project-Drive" "${CMAKE_CURRENT_BINARY_DIR}/project-drive")

add_executable(WorldSimulationAndSdfValidation
    Code/WorldSimulationAndSdfValidation.cpp)

target_compile_features(WorldSimulationAndSdfValidation PRIVATE cxx_std_20)
target_include_directories(WorldSimulationAndSdfValidation PRIVATE
    "${FRONTIER_REPO_ROOT}/Frontier")

target_link_libraries(WorldSimulationAndSdfValidation PRIVATE
    FrontierPlumeFluid
    FrontierShallowWater
    FrontierWindField
    FrontierSnowLightning
    FrontierSolidFracture
    FrontierParticles
    FrontierSceneRenderer
    FrontierGameMechanics
    FrontierAudioFoundation
    FrontierRigidBodyPhysics
    ProjectDriveSimulation)

if(MSVC)
    target_compile_options(WorldSimulationAndSdfValidation PRIVATE /utf-8 /W4)
else()
    target_compile_options(WorldSimulationAndSdfValidation PRIVATE -Wall -Wextra -Werror)
endif()
