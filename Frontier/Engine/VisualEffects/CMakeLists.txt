cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Shared 3D Wind & Force-Field toroidal lattice + Cloud-Gated Vose-Alias budgeted weather/debris particle spawner.
if(NOT TARGET FrontierWindField)
    add_library(FrontierWindField STATIC WindField.cpp)
    target_compile_features(FrontierWindField PUBLIC cxx_std_20)
    target_link_libraries(FrontierWindField PUBLIC FrontierAtmosphericOptics FrontierPlumeFluid)
    target_include_directories(FrontierWindField PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierWindField PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierWindField PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 Single-PolygonSurface snowpack & hail accumulation, Snow Pit rut carving, Stefan melt, and Lightning & Thunder.
if(NOT TARGET FrontierSnowLightning)
    add_library(FrontierSnowLightning STATIC
        SnowSurface.cpp
        LightningStorm.cpp)
    target_compile_features(FrontierSnowLightning PUBLIC cxx_std_20)
    target_link_libraries(FrontierSnowLightning PUBLIC FrontierWindField FrontierShallowWater)
    target_include_directories(FrontierSnowLightning PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierSnowLightning PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierSnowLightning PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 41k Hipparcos octahedral star catalogue, custom stars, textured Moon + 6-body lunar atlas, and 3D ringed planets + atmospheres.
if(NOT TARGET FrontierCelestialSky)
    add_library(FrontierCelestialSky STATIC CelestialSky.cpp)
    target_compile_features(FrontierCelestialSky PUBLIC cxx_std_20)
    target_link_libraries(FrontierCelestialSky PUBLIC FrontierAtmosphericOptics)
    target_include_directories(FrontierCelestialSky PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierCelestialSky PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierCelestialSky PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
