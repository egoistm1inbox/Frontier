cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierAudio LANGUAGES CXX)
endif()

add_library(FrontierAudioFoundation INTERFACE)
target_compile_features(FrontierAudioFoundation INTERFACE cxx_std_17)
target_include_directories(FrontierAudioFoundation INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/../..")
