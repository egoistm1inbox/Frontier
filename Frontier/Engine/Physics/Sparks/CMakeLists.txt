cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Swept-collision incandescent metallic sparks with Planckian radiative cooling and dynamic shadowed scene illumination.
if(NOT TARGET FrontierBallisticSparks)
    add_library(FrontierBallisticSparks STATIC BallisticSparkExtension.cpp)
    target_compile_features(FrontierBallisticSparks PUBLIC cxx_std_20)
    target_include_directories(FrontierBallisticSparks PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../../..")
    if(MSVC)
        target_compile_options(FrontierBallisticSparks PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierBallisticSparks PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
