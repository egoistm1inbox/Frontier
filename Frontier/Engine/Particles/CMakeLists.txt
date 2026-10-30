cmake_minimum_required(VERSION 3.20)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 📝 Swept-collision incandescent metallic sparks and wind-advected 3D sky precipitation particles (snow, sleet, rain).
if(NOT TARGET FrontierParticles)
    add_library(FrontierParticles STATIC
        SparkParticles.cpp
        SkyPrecipitation.cpp)
    target_compile_features(FrontierParticles PUBLIC cxx_std_20)
    target_include_directories(FrontierParticles PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierParticles PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierParticles PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
