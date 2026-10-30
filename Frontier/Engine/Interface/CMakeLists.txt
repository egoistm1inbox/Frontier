cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Native Vehicle Cabin Digital Cluster, 12-App Central Infotainment Screen, and Windshield HUD Telemetry.
if(NOT TARGET FrontierVehicleCabinHmi)
    add_library(FrontierVehicleCabinHmi STATIC VehicleCabinHmiExtension.cpp)
    target_compile_features(FrontierVehicleCabinHmi PUBLIC cxx_std_20)
    target_include_directories(FrontierVehicleCabinHmi PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierVehicleCabinHmi PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierVehicleCabinHmi PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
