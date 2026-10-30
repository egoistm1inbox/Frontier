cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Native 3D smoke-and-fire fluid extension: MacCormack transport, compatible pressure, solid collisions, shadows & lighting.
if(NOT TARGET FrontierPlumeFluid)
    add_library(FrontierPlumeFluid STATIC PlumeFluid.cpp)
    target_compile_features(FrontierPlumeFluid PUBLIC cxx_std_20)
    target_link_libraries(FrontierPlumeFluid PUBLIC FrontierPlumeLatticeFootprint)
    target_include_directories(FrontierPlumeFluid PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierPlumeFluid PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierPlumeFluid PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 2.5D Saint-Venant shallow-water & Bingham-plastic mud extension (puddles, fords, mud pits, nested domain link).
if(NOT TARGET FrontierShallowWater)
    add_library(FrontierShallowWater STATIC ShallowWater.cpp)
    target_compile_features(FrontierShallowWater PUBLIC cxx_std_20)
    target_include_directories(FrontierShallowWater PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierShallowWater PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierShallowWater PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
