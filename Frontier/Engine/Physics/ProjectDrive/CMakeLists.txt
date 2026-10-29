cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierProjectDriveCore LANGUAGES CXX)
endif()

# Standalone opt-in library. The editor and the existing HTML-demo VehicleSolver do not automatically link it.
add_library(FrontierProjectDrivePhysics STATIC
    Aerodynamics.cpp
    Drivetrain.cpp
    PacejkaMagicFormula.cpp
    TyreSlipDynamics.cpp
    VehicleGeometry.cpp
    VehicleSolver.cpp
    TyreVisualBridge.cpp
    ../TyreContinuum.cpp)
target_compile_features(FrontierProjectDrivePhysics PUBLIC cxx_std_17)
target_include_directories(FrontierProjectDrivePhysics PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../../..")
set_target_properties(FrontierProjectDrivePhysics PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(MSVC)
    target_compile_options(FrontierProjectDrivePhysics PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierProjectDrivePhysics PRIVATE -Wall -Wextra -Werror)
endif()

# Reusable Engine vehicle + Jolt rigid-body assembly, spawn solver, input integrator, and chase camera projection.
if(TARGET FrontierRigidBodyPhysics)
    add_library(FrontierProjectDriveJolt STATIC
        ChaseCameraProjection.cpp
        VehicleRigidBodyAssembly.cpp)
    target_compile_features(FrontierProjectDriveJolt PUBLIC cxx_std_20)
    target_include_directories(FrontierProjectDriveJolt PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../../..")
    set_target_properties(FrontierProjectDriveJolt PROPERTIES POSITION_INDEPENDENT_CODE ON)
    if(MSVC)
        target_compile_options(FrontierProjectDriveJolt PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierProjectDriveJolt PRIVATE -Wall -Wextra -Werror)
    endif()
    target_link_libraries(FrontierProjectDriveJolt PUBLIC
        FrontierProjectDrivePhysics
        FrontierRigidBodyPhysics)
endif()
