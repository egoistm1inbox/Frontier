cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierThreading LANGUAGES CXX)
endif()

find_package(Threads REQUIRED)

add_library(FrontierThreading STATIC
    WorkerPool.cpp
    TaskGraphExtension.cpp)
target_compile_features(FrontierThreading PUBLIC cxx_std_17)
target_include_directories(FrontierThreading PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
target_link_libraries(FrontierThreading PUBLIC Threads::Threads)
if(MSVC)
    target_compile_options(FrontierThreading PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierThreading PRIVATE -Wall -Wextra -Werror)
endif()
