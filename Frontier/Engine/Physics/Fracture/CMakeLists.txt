cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Griffith surface-energy budgeted 3D convex polyhedron fracture (6 material presets, volume conservation, adjacency bonds).
if(NOT TARGET FrontierSolidFracture)
    add_library(FrontierSolidFracture STATIC SolidFracture.cpp)
    target_compile_features(FrontierSolidFracture PUBLIC cxx_std_20)
    target_include_directories(FrontierSolidFracture PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../../..")
    if(MSVC)
        target_compile_options(FrontierSolidFracture PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierSolidFracture PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
