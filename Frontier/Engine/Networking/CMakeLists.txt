cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierNetworking LANGUAGES CXX)
endif()

add_library(FrontierNetworking STATIC
    StateReplication.cpp)
target_compile_features(FrontierNetworking PUBLIC cxx_std_17)
target_include_directories(FrontierNetworking PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierNetworking PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierNetworking PRIVATE -Wall -Wextra -Werror)
endif()
