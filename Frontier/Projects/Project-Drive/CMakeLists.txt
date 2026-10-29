cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(ProjectDrive LANGUAGES CXX)
endif()

get_filename_component(PROJECT_DRIVE_FRONTIER_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
get_filename_component(PROJECT_DRIVE_REPO_ROOT "${PROJECT_DRIVE_FRONTIER_ROOT}/.." ABSOLUTE)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)
find_package(Threads REQUIRED)

if(NOT TARGET FrontierAtmosphericOptics)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Rendering"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-rendering")
endif()

if(NOT TARGET FrontierRigidBodyPhysics)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Physics"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-physics")
endif()

if(NOT TARGET FrontierProjectDriveJolt)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Physics/ProjectDrive"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-project-drive")
endif()

if(NOT TARGET FrontierProjectDriveJolt)
    message(FATAL_ERROR
        "Project-Drive requires Jolt Physics under ExternalPackages/jolt; run: bash Automation/BuildJolt.sh")
endif()

if(NOT DEFINED FRONTIER_INTERCHANGE_INCLUDE_DIR)
    set(FRONTIER_INTERCHANGE_INCLUDE_DIR "${PROJECT_DRIVE_REPO_ROOT}/Exhibits/LogStream/Support")
endif()

add_library(ProjectDriveSimulation STATIC
    Source/DriveSimulation.cpp)
target_compile_features(ProjectDriveSimulation PUBLIC cxx_std_20)
target_include_directories(ProjectDriveSimulation PUBLIC
    "${PROJECT_DRIVE_FRONTIER_ROOT}"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source")
set_target_properties(ProjectDriveSimulation PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(MSVC)
    target_compile_options(ProjectDriveSimulation PRIVATE /utf-8 /W4)
else()
    target_compile_options(ProjectDriveSimulation PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(ProjectDriveSimulation PUBLIC FrontierProjectDriveJolt)

add_library(ProjectDriveVehicleHmiScene STATIC
    Source/VehicleHmiScene.cpp)
target_compile_features(ProjectDriveVehicleHmiScene PUBLIC cxx_std_20)
target_include_directories(ProjectDriveVehicleHmiScene PUBLIC
    "${PROJECT_DRIVE_FRONTIER_ROOT}"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source")
set_target_properties(ProjectDriveVehicleHmiScene PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(MSVC)
    target_compile_options(ProjectDriveVehicleHmiScene PRIVATE /utf-8 /W4)
else()
    target_compile_options(ProjectDriveVehicleHmiScene PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(ProjectDriveVehicleHmiScene PUBLIC
    ProjectDriveSimulation
    FrontierAtmosphericOptics
    FrontierPhotometricClustering
    FrontierPlumeFluid
    Threads::Threads)

add_library(ProjectDrive SHARED
    Source/ProjectDriveInterchange.cpp)
target_compile_features(ProjectDrive PRIVATE cxx_std_20)
target_include_directories(ProjectDrive PRIVATE
    "${FRONTIER_INTERCHANGE_INCLUDE_DIR}"
    "${PROJECT_DRIVE_FRONTIER_ROOT}"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source")
if(MSVC)
    target_compile_options(ProjectDrive PRIVATE /utf-8 /W4)
else()
    target_compile_options(ProjectDrive PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(ProjectDrive PRIVATE ProjectDriveSimulation)
set_target_properties(ProjectDrive PROPERTIES
    PREFIX ""
    SUFFIX ".dll"
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/Output"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/Output")
if(UNIX AND NOT APPLE)
    target_link_options(ProjectDrive PRIVATE -Wl,-Bsymbolic -Wl,--exclude-libs,ALL)
endif()
