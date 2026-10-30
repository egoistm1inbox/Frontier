cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierPhysics LANGUAGES CXX)
endif()

get_filename_component(FRONTIER_PHYSICS_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)

# 📝 Standalone visual projection and Hex8 deformation; no vehicle dynamics or Jolt dependency.
if(NOT TARGET FrontierTyreMechanics)
    add_library(FrontierTyreMechanics STATIC TyreContinuum.cpp TyreProjectionDevice.cpp TyreSolidDevice.cpp)
    target_compile_features(FrontierTyreMechanics PUBLIC cxx_std_17)
    target_include_directories(FrontierTyreMechanics PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierTyreMechanics PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierTyreMechanics PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 Propulsion & gameplay mechanics live in Engine/Gameplay/GameMechanics; particle systems live in Engine/Particles.
if(NOT TARGET FrontierPropulsion)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Gameplay/GameMechanics" "${CMAKE_CURRENT_BINARY_DIR}/FrontierGameMechanics")
endif()
if(NOT TARGET FrontierSolidFracture)
    add_subdirectory(Fracture)
endif()
if(NOT TARGET FrontierParticles)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Particles" "${CMAKE_CURRENT_BINARY_DIR}/FrontierParticles")
endif()

# 📝 Optional caller-owned Vulkan command recorder; the CPU tyre library has no Vulkan dependency.
if(FRONTIER_TYRE_VULKAN_HEADERS)
    add_library(FrontierTyreProjectionVulkan STATIC TyreProjectionVulkan.cpp)
    target_compile_features(FrontierTyreProjectionVulkan PUBLIC cxx_std_17)
    target_include_directories(FrontierTyreProjectionVulkan PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../.."
        "${FRONTIER_TYRE_VULKAN_HEADERS}")
    if(MSVC)
        target_compile_options(FrontierTyreProjectionVulkan PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierTyreProjectionVulkan PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 Reusable Jolt Physics rigid-body world + VehiclePhysicsThread (enabled automatically when Jolt is present).
if(NOT DEFINED FRONTIER_JOLT_ROOT)
    set(FRONTIER_JOLT_ROOT "${FRONTIER_PHYSICS_REPO_ROOT}/ExternalPackages/jolt")
endif()
if(NOT DEFINED FRONTIER_JOLT_LIBRARY)
    set(FRONTIER_JOLT_LIBRARY "${FRONTIER_JOLT_ROOT}/lib/Release/libJolt.a")
endif()

if(EXISTS "${FRONTIER_JOLT_ROOT}/Jolt/Jolt.h" AND EXISTS "${FRONTIER_JOLT_LIBRARY}")
    find_package(Threads REQUIRED)
    add_library(FrontierRigidBodyPhysics STATIC
        RigidBodySolver.cpp
        VehiclePhysicsThread.cpp)
    target_compile_features(FrontierRigidBodyPhysics PUBLIC cxx_std_20)
    target_include_directories(FrontierRigidBodyPhysics
        PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../.."
        PRIVATE "${FRONTIER_JOLT_ROOT}")
    set_target_properties(FrontierRigidBodyPhysics PROPERTIES POSITION_INDEPENDENT_CODE ON)
    if(MSVC)
        target_compile_options(FrontierRigidBodyPhysics PRIVATE /utf-8 /W4 /arch:AVX)
        target_compile_definitions(FrontierRigidBodyPhysics PRIVATE $<$<NOT:$<CONFIG:Debug>>:NDEBUG>)
    else()
        target_compile_options(FrontierRigidBodyPhysics PRIVATE
            -Wall -Wextra -Werror -Wno-psabi -Wno-stringop-overflow)
        if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64|amd64")
            target_compile_options(FrontierRigidBodyPhysics PRIVATE -mavx -mpopcnt -mfpmath=sse)
        endif()
        target_compile_definitions(FrontierRigidBodyPhysics PRIVATE $<$<NOT:$<CONFIG:Debug>>:NDEBUG>)
    endif()
    target_link_libraries(FrontierRigidBodyPhysics PUBLIC "${FRONTIER_JOLT_LIBRARY}" Threads::Threads)
endif()
