cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Fuel/Mixture/Additive thermochemistry, Forced Induction, BEV/Hybrid propulsion, and calibrated .tyrx tyre thermodynamics.
if(NOT TARGET FrontierPropulsion)
    add_library(FrontierPropulsion STATIC
        Propulsion/PropulsionThermochemistry.cpp
        Propulsion/HybridElectricPropulsion.cpp
        Propulsion/CalibratedTyreThermodynamics.cpp)
    target_compile_features(FrontierPropulsion PUBLIC cxx_std_17)
    target_include_directories(FrontierPropulsion PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../../..")
    if(MSVC)
        target_compile_options(FrontierPropulsion PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierPropulsion PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

if(NOT TARGET FrontierSceneRenderer)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../../Rendering" "${CMAKE_CURRENT_BINARY_DIR}/FrontierRendering")
endif()

# 📝 Gameplay mechanics: ControlVehicle 3D Cabin HMI (SVG icons, 3D Garage turntable, shaped cluster) and Portal transit/blocking.
if(NOT TARGET FrontierGameMechanics)
    add_library(FrontierGameMechanics STATIC
        CabinIconDepot.cpp
        PortalMechanics.cpp
        VehicleCabinHmi.cpp)
    target_compile_features(FrontierGameMechanics PUBLIC cxx_std_20)
    target_link_libraries(FrontierGameMechanics PUBLIC FrontierSceneRenderer)
    target_include_directories(FrontierGameMechanics PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../../..")
    if(MSVC)
        target_compile_options(FrontierGameMechanics PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierGameMechanics PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
