cmake_minimum_required(VERSION 3.20)
project(VehicleHmiShowcaseValidation LANGUAGES CXX)

option(FRONTIER_SHOWCASE_SANITIZERS "Enable ASan + UBSan for VehicleHMI, PlumeFluid, Tyre, and Weather validation" OFF)

get_filename_component(SHOWCASE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

add_subdirectory(
    "${SHOWCASE_REPO_ROOT}/Frontier/Projects/Project-Drive"
    "${CMAKE_CURRENT_BINARY_DIR}/project-drive")

add_executable(VehicleHmiFluidWeatherValidation
    Code/VehicleHmiFluidWeatherValidation.cpp)
target_compile_features(VehicleHmiFluidWeatherValidation PRIVATE cxx_std_20)
target_include_directories(VehicleHmiFluidWeatherValidation PRIVATE
    "${SHOWCASE_REPO_ROOT}/Frontier"
    "${SHOWCASE_REPO_ROOT}/Frontier/Projects/Project-Drive/Source")
if(MSVC)
    target_compile_options(VehicleHmiFluidWeatherValidation PRIVATE /utf-8 /W4)
else()
    target_compile_options(VehicleHmiFluidWeatherValidation PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(VehicleHmiFluidWeatherValidation PRIVATE ProjectDriveVehicleHmiScene)

if(FRONTIER_SHOWCASE_SANITIZERS AND NOT MSVC)
    foreach(SanTarget
        FrontierPlumeFluid
        FrontierAtmosphericOptics
        FrontierPhotometricLights
        FrontierProjectDrivePhysics
        FrontierProjectDriveJolt
        ProjectDriveSimulation
        ProjectDriveVehicleHmiScene
        VehicleHmiFluidWeatherValidation)
        if(TARGET ${SanTarget})
            target_compile_options(${SanTarget} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
            target_link_options(${SanTarget} PUBLIC -fsanitize=address,undefined)
        endif()
    endforeach()
endif()
