cmake_minimum_required(VERSION 3.20)
project(FrontierProjectDriveJoltSuite LANGUAGES CXX)

option(FRONTIER_DRIVE_SANITIZERS "Enable ASan and UBSan on Frontier Engine and Project-Drive targets" OFF)

get_filename_component(REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
set(FRONTIER_ROOT "${REPO_ROOT}/Frontier")

add_subdirectory("${FRONTIER_ROOT}/Projects/Project-Drive" "${CMAKE_CURRENT_BINARY_DIR}/project-drive")

add_executable(ProjectDriveJoltValidation
    "${CMAKE_CURRENT_SOURCE_DIR}/../Code/ProjectDriveJoltValidation.cpp")
target_compile_features(ProjectDriveJoltValidation PRIVATE cxx_std_20)
target_include_directories(ProjectDriveJoltValidation PRIVATE
    "${FRONTIER_ROOT}"
    "${REPO_ROOT}/Exhibits/LogStream/Support")
if(MSVC)
    target_compile_options(ProjectDriveJoltValidation PRIVATE /utf-8 /W4)
else()
    target_compile_options(ProjectDriveJoltValidation PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(ProjectDriveJoltValidation PRIVATE
    ProjectDriveSimulation
    ${CMAKE_DL_LIBS})

if(FRONTIER_DRIVE_SANITIZERS AND NOT MSVC)
    foreach(SanitizedTarget
            FrontierProjectDrivePhysics
            FrontierRigidBodyPhysics
            FrontierProjectDriveJolt
            ProjectDriveSimulation
            ProjectDrive
            ProjectDriveJoltValidation)
        if(TARGET ${SanitizedTarget})
            target_compile_options(${SanitizedTarget} PRIVATE -O1 -g -fno-omit-frame-pointer -fsanitize=address,undefined)
            target_link_options(${SanitizedTarget} PRIVATE -fsanitize=address,undefined)
        endif()
    endforeach()
endif()

enable_testing()
add_test(
    NAME ProjectDriveJoltValidation
    COMMAND ProjectDriveJoltValidation "$<TARGET_FILE:ProjectDrive>")
