cmake_minimum_required(VERSION 3.22)

if(NOT TARGET FrontierGeometryProcessing)
    add_library(FrontierGeometryProcessing STATIC
        FacetTierBuild.cpp
        QuadricTierBuild.cpp
        ClusterHierarchy.cpp
    )

    target_include_directories(FrontierGeometryProcessing PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/../.."
    )

    target_compile_features(FrontierGeometryProcessing PUBLIC cxx_std_20)
    if(MSVC)
        target_compile_options(FrontierGeometryProcessing PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierGeometryProcessing PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
