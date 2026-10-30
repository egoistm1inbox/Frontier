cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(ProjectDrive LANGUAGES C CXX)
endif()

option(FRONTIER_PROJECT_DRIVE_SHIPPING "Build Shipping runtime without Editor UI / SceneDirectory" OFF)
option(FRONTIER_CI_RELAX_WERROR "Relax -Werror for cross-distro / cross-compiler CI packaging" OFF)

get_filename_component(PROJECT_DRIVE_FRONTIER_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
get_filename_component(PROJECT_DRIVE_REPO_ROOT "${PROJECT_DRIVE_FRONTIER_ROOT}/.." ABSOLUTE)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
find_package(Threads REQUIRED)

if(MSVC)
    add_compile_options(/utf-8 $<$<COMPILE_LANGUAGE:CXX>:/bigobj> $<$<COMPILE_LANGUAGE:CXX>:/FIcstdint>)
    add_compile_definitions(_CRT_SECURE_NO_WARNINGS _USE_MATH_DEFINES NOMINMAX WIN32_LEAN_AND_MEAN)
else()
    add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-include> $<$<COMPILE_LANGUAGE:CXX>:cstdint>)
endif()

if(NOT TARGET FrontierAudioFoundation)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Audio"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-audio")
endif()

set(FRONTIER_RENDERING_VULKAN_HEADERS "${PROJECT_DRIVE_REPO_ROOT}/ExternalPackages/vulkan-headers/include")
if(NOT TARGET FrontierAtmosphericOptics)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Rendering"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-rendering")
endif()

if(NOT TARGET FrontierRigidBodyPhysics)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Physics"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-physics")
endif()

if(NOT TARGET FrontierNetworking)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Networking"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-networking")
endif()

if(NOT TARGET FrontierProjectDriveJolt)
    add_subdirectory(
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Physics/ProjectDrive"
        "${CMAKE_CURRENT_BINARY_DIR}/engine-project-drive")
endif()

if(NOT TARGET FrontierProjectDriveJolt)
    message(FATAL_ERROR
        "Project-Drive requires Jolt Physics under ExternalPackages/jolt; run: bash Automation/BuildJolt.sh")
endif()

if(NOT DEFINED FRONTIER_INTERCHANGE_INCLUDE_DIR)
    set(FRONTIER_INTERCHANGE_INCLUDE_DIR "${PROJECT_DRIVE_REPO_ROOT}/Exhibits/LogStream/Support")
endif()

add_library(ProjectDriveSimulation STATIC
    Source/DriveSimulation.cpp)
target_compile_features(ProjectDriveSimulation PUBLIC cxx_std_20)
target_include_directories(ProjectDriveSimulation PUBLIC
    "${PROJECT_DRIVE_FRONTIER_ROOT}"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source")
set_target_properties(ProjectDriveSimulation PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(MSVC)
    target_compile_options(ProjectDriveSimulation PRIVATE /utf-8 /W4)
else()
    target_compile_options(ProjectDriveSimulation PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(ProjectDriveSimulation PUBLIC FrontierProjectDriveJolt)

add_library(ProjectDriveVehicleHmiScene STATIC
    Source/VehicleHmiScene.cpp)
target_compile_features(ProjectDriveVehicleHmiScene PUBLIC cxx_std_20)
target_include_directories(ProjectDriveVehicleHmiScene PUBLIC
    "${PROJECT_DRIVE_FRONTIER_ROOT}"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source")
set_target_properties(ProjectDriveVehicleHmiScene PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(MSVC)
    target_compile_options(ProjectDriveVehicleHmiScene PRIVATE /utf-8 /W4)
else()
    target_compile_options(ProjectDriveVehicleHmiScene PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(ProjectDriveVehicleHmiScene PUBLIC
    ProjectDriveSimulation
    FrontierPropulsion
    FrontierAtmosphericOptics
    FrontierPhotometricLights
    FrontierPlumeFluid
    FrontierWindField
    Threads::Threads)

add_library(ProjectDrive SHARED
    Source/ProjectDriveInterchange.cpp)
target_compile_features(ProjectDrive PRIVATE cxx_std_20)
target_include_directories(ProjectDrive PRIVATE
    "${FRONTIER_INTERCHANGE_INCLUDE_DIR}"
    "${PROJECT_DRIVE_FRONTIER_ROOT}"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source")
if(MSVC)
    target_compile_options(ProjectDrive PRIVATE /utf-8 /W4)
else()
    target_compile_options(ProjectDrive PRIVATE -Wall -Wextra -Werror)
endif()
target_link_libraries(ProjectDrive PRIVATE ProjectDriveSimulation)
set_target_properties(ProjectDrive PROPERTIES
    PREFIX ""
    SUFFIX ".dll"
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/Output"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/Output"
    ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/Output"
    PDB_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/Output")
if(MSVC)
    target_link_options(ProjectDrive PRIVATE /EXPORT:ConstructProjectInterchange)
elseif(UNIX AND NOT APPLE)
    target_link_options(ProjectDrive PRIVATE -Wl,-Bsymbolic -Wl,--exclude-libs,ALL)
endif()

#------------------------------------------------------------------------------------------------------------------------
#       UNIFIED PROJECT-DRIVE APPLICATION BINARY (NATIVE VULKAN EDITOR + RUNTIME OR SHIPPING PROFILE)
#------------------------------------------------------------------------------------------------------------------------

set(PROJECT_DRIVE_CORE_SCENE_SOURCES
    Source/DriveShowcaseRecords.cpp
    Source/DriveShowcaseWorld.cpp
    Source/ProjectDriveMain.cpp
    "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Diagnostics/LogRingStore.cpp"
    "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Diagnostics/LogCategories.cpp"
    "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Diagnostics/LogStream.cpp"
    "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Scene/RecordStore.cpp"
    "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Scene/RecordEntry.cpp")

if(FRONTIER_PROJECT_DRIVE_SHIPPING)
    add_executable(ProjectDriveShipping
        ${PROJECT_DRIVE_CORE_SCENE_SOURCES})
    target_include_directories(ProjectDriveShipping PRIVATE
        "${PROJECT_DRIVE_FRONTIER_ROOT}"
        "${PROJECT_DRIVE_REPO_ROOT}"
        "${CMAKE_CURRENT_SOURCE_DIR}/Source")
    target_compile_definitions(ProjectDriveShipping PRIVATE FRONTIER_SHIPPING_PROFILE=1)
    target_link_libraries(ProjectDriveShipping PRIVATE
        ProjectDriveSimulation
        ProjectDriveVehicleHmiScene
        FrontierSceneRenderer
        FrontierGameMechanics
        FrontierGeometryProcessing
        FrontierPlumeFluid
        FrontierShallowWater
        FrontierParticles
        FrontierSolidFracture
        FrontierSnowLightning
        FrontierCelestialSky
        FrontierWindField
        FrontierNetworking
        Threads::Threads)
    set_target_properties(ProjectDriveShipping PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/Shipping")
else()
    if(NOT TARGET thorvg_static)
        set(CMAKE_SOURCE_DIR_SAVED "${CMAKE_SOURCE_DIR}")
        set(CMAKE_SOURCE_DIR "${PROJECT_DRIVE_REPO_ROOT}")
        include("${PROJECT_DRIVE_REPO_ROOT}/Automation/ThorVGSoftware.cmake")
        set(CMAKE_SOURCE_DIR "${CMAKE_SOURCE_DIR_SAVED}")
    endif()

    # Native GLFW + Vulkan presentation (VK_NO_PROTOTYPES; zero DirectX 11 dependencies!)
    if(NOT TARGET glfw)
        set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
        set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
        set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_WAYLAND OFF CACHE BOOL "" FORCE)
        if(UNIX AND NOT APPLE)
            find_package(X11 QUIET)
            if(X11_FOUND AND X11_Xrandr_INCLUDE_PATH AND X11_Xinerama_INCLUDE_PATH AND
               X11_Xkb_INCLUDE_PATH AND X11_Xcursor_INCLUDE_PATH AND X11_Xi_INCLUDE_PATH AND X11_Xshape_INCLUDE_PATH)
                set(GLFW_BUILD_X11 ON CACHE BOOL "" FORCE)
            else()
                set(GLFW_BUILD_X11 OFF CACHE BOOL "" FORCE)
            endif()
        endif()
        add_subdirectory(
            "${PROJECT_DRIVE_REPO_ROOT}/ExternalPackages/glfw"
            "${CMAKE_CURRENT_BINARY_DIR}/glfw"
            EXCLUDE_FROM_ALL)
    endif()

    set(PROJECT_DRIVE_IMGUI_ROOT "${PROJECT_DRIVE_REPO_ROOT}/ExternalPackages/imgui")
    set(PROJECT_DRIVE_VULKAN_HEADERS "${PROJECT_DRIVE_REPO_ROOT}/ExternalPackages/vulkan-headers/include")
    set(PROJECT_DRIVE_IMGUI_SOURCES
        "${PROJECT_DRIVE_IMGUI_ROOT}/imgui.cpp"
        "${PROJECT_DRIVE_IMGUI_ROOT}/imgui_draw.cpp"
        "${PROJECT_DRIVE_IMGUI_ROOT}/imgui_tables.cpp"
        "${PROJECT_DRIVE_IMGUI_ROOT}/imgui_widgets.cpp"
        "${PROJECT_DRIVE_IMGUI_ROOT}/backends/imgui_impl_glfw.cpp"
        "${PROJECT_DRIVE_IMGUI_ROOT}/backends/imgui_impl_vulkan.cpp")
    add_library(ProjectDriveImGui STATIC ${PROJECT_DRIVE_IMGUI_SOURCES})
    target_include_directories(ProjectDriveImGui PUBLIC
        "${PROJECT_DRIVE_IMGUI_ROOT}"
        "${PROJECT_DRIVE_IMGUI_ROOT}/backends"
        "${PROJECT_DRIVE_VULKAN_HEADERS}")
    target_compile_definitions(ProjectDriveImGui PUBLIC
        "ImDrawIdx=unsigned int"
        FRONTIER_UI_VULKAN=1
        VK_NO_PROTOTYPES
        GLFW_INCLUDE_NONE)
    target_link_libraries(ProjectDriveImGui PUBLIC glfw)

    add_library(ProjectDriveUiSdk STATIC
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/VulkanPresentation.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/TextFileReplacement.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/ThumbnailAtlasCache.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/IconArt.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/IconPresentation.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/PixelSpace.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/GlyphSpace.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/ControlKit.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/TextEntryState.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/ThemeStructure.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/VectorCodec.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/ContentDirectory.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/FontCodec.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/TypefaceRegistry.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/AppearanceInspector.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/AppearanceCodec.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/MotionIntegrator.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/PanelExpansionTab.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/ConfigurationInspector.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/ConfigurationStructure.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/InputPreferencesCodec.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/MonitorPlacement.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/PanelDockspaceMonitor.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/PanelDockspace.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/PanelDockspaceLayout.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/NotificationSequence.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/Interface/ConfirmationDialogue.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/Engine/ContentInterchange/ProjectSpaceCodec.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/UI/Editor/ContentBrowserPanel.cpp"
        "${PROJECT_DRIVE_REPO_ROOT}/UI/Editor/ControlCentrePanel.cpp"
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Scene/SceneDirectory.cpp"
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Interface/StackRailControls.cpp"
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Interface/SceneDirectoryPanel.cpp"
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Interface/SceneDirectoryPanelPresentation.cpp"
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Interface/SceneInspectorPanel.cpp"
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Interface/LogStreamPanel.cpp"
        "${PROJECT_DRIVE_FRONTIER_ROOT}/Engine/Interface/LogStreamPanelPresentation.cpp")
    target_include_directories(ProjectDriveUiSdk PUBLIC
        "${PROJECT_DRIVE_FRONTIER_ROOT}"
        "${PROJECT_DRIVE_REPO_ROOT}"
        "${PROJECT_DRIVE_REPO_ROOT}/ExternalPackages/tomlpp/include"
        "${PROJECT_DRIVE_VULKAN_HEADERS}")
    target_compile_definitions(ProjectDriveUiSdk PUBLIC
        FRONTIER_EDITOR=1
        FRONTIER_EDITOR_PROFILE=1
        FRONTIER_WITH_INTERFACE_SDK=1
        FRONTIER_UI_VULKAN=1
        VK_NO_PROTOTYPES
        GLFW_INCLUDE_NONE)
    target_link_libraries(ProjectDriveUiSdk PUBLIC ProjectDriveImGui thorvg_static)

    add_executable(ProjectDriveApp
        Source/InfographicWidgets.cpp
        Source/DedicatedEntityEditors.cpp
        Source/VulkanShaderCompiler.cpp
        ${PROJECT_DRIVE_CORE_SCENE_SOURCES})
    target_include_directories(ProjectDriveApp PRIVATE
        "${PROJECT_DRIVE_FRONTIER_ROOT}"
        "${PROJECT_DRIVE_REPO_ROOT}"
        "${PROJECT_DRIVE_REPO_ROOT}/Exhibits/ControlCentre/Code"
        "${PROJECT_DRIVE_REPO_ROOT}/ExternalPackages/stb"
        "${PROJECT_DRIVE_VULKAN_HEADERS}"
        "${CMAKE_CURRENT_SOURCE_DIR}/Source")
    target_compile_definitions(ProjectDriveApp PRIVATE
        FRONTIER_EDITOR=1
        FRONTIER_EDITOR_PROFILE=1
        FRONTIER_WITH_INTERFACE_SDK=1
        FRONTIER_UI_VULKAN=1
        VK_NO_PROTOTYPES
        GLFW_INCLUDE_NONE)
    target_link_libraries(ProjectDriveApp PRIVATE
        ProjectDriveUiSdk
        ProjectDriveSimulation
        ProjectDriveVehicleHmiScene
        FrontierSceneRenderer
        FrontierPathReplayVulkan
        FrontierGameMechanics
        FrontierGeometryProcessing
        FrontierPlumeFluid
        FrontierShallowWater
        FrontierParticles
        FrontierSolidFracture
        FrontierSnowLightning
        FrontierCelestialSky
        FrontierWindField
        FrontierNetworking
        Threads::Threads
        ${CMAKE_DL_LIBS})
    if(WIN32)
        target_link_libraries(ProjectDriveApp PRIVATE dwmapi imm32 user32 gdi32 shell32)
    endif()
    set_target_properties(ProjectDriveApp PROPERTIES
        OUTPUT_NAME "ProjectDrive"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/Binaries")
endif()

if(FRONTIER_CI_RELAX_WERROR AND NOT MSVC)
    function(frontier_relax_werror_recursive dir)
        get_property(targets DIRECTORY "${dir}" PROPERTY BUILDSYSTEM_TARGETS)
        foreach(tgt IN LISTS targets)
            get_target_property(tgt_type "${tgt}" TYPE)
            if(tgt_type STREQUAL "STATIC_LIBRARY" OR tgt_type STREQUAL "SHARED_LIBRARY" OR
               tgt_type STREQUAL "MODULE_LIBRARY" OR tgt_type STREQUAL "OBJECT_LIBRARY" OR
               tgt_type STREQUAL "EXECUTABLE")
                target_compile_options("${tgt}" PRIVATE -Wno-error)
            endif()
        endforeach()
        get_property(subdirs DIRECTORY "${dir}" PROPERTY SUBDIRECTORIES)
        foreach(sub IN LISTS subdirs)
            frontier_relax_werror_recursive("${sub}")
        endforeach()
    endfunction()
    frontier_relax_werror_recursive("${CMAKE_CURRENT_SOURCE_DIR}")
endif()
