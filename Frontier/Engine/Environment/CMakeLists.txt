cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Shared 3D Wind & Force-Field toroidal lattice + Cloud-Gated Vose-Alias budgeted weather/debris particle spawner.
if(NOT TARGET FrontierWindForceField)
    add_library(FrontierWindForceField STATIC WindForceFieldExtension.cpp)
    target_compile_features(FrontierWindForceField PUBLIC cxx_std_20)
    target_link_libraries(FrontierWindForceField PUBLIC FrontierAtmosphericOptics FrontierPlumeFluid)
    target_include_directories(FrontierWindForceField PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierWindForceField PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierWindForceField PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 Single-PolygonSurface snowpack & hail accumulation, Snow Pit rut carving, Stefan melt, and Lightning & Thunder.
if(NOT TARGET FrontierSnowLightningEnvironment)
    add_library(FrontierSnowLightningEnvironment STATIC
        SnowpackAccumulationExtension.cpp
        LightningThunderExtension.cpp)
    target_compile_features(FrontierSnowLightningEnvironment PUBLIC cxx_std_20)
    target_link_libraries(FrontierSnowLightningEnvironment PUBLIC FrontierWindForceField FrontierShallowWaterMud)
    target_include_directories(FrontierSnowLightningEnvironment PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierSnowLightningEnvironment PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierSnowLightningEnvironment PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 41k Hipparcos octahedral star catalogue, custom stars, textured Moon + 6-body lunar atlas, and 3D ringed planets + atmospheres.
if(NOT TARGET FrontierCelestialPlanetary)
    add_library(FrontierCelestialPlanetary STATIC CelestialPlanetaryExtension.cpp)
    target_compile_features(FrontierCelestialPlanetary PUBLIC cxx_std_20)
    target_link_libraries(FrontierCelestialPlanetary PUBLIC FrontierAtmosphericOptics)
    target_include_directories(FrontierCelestialPlanetary PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierCelestialPlanetary PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierCelestialPlanetary PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
