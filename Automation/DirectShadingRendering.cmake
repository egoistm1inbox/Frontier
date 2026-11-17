#============================================================================================================================================
#                                                      DIRECTSHADINGRENDERING.CMAKE
#============================================================================================================================================
# 🧩 Direct shading: the editor's fast direct-lighting rasterizer (one shadowed sun, Lambert and Blinn-Phong surfaces, hemisphere
#    fill, gradient sky) of the scene the global illumination loaded, and its Slang units (archive set DirectShading).

add_library(FrontierDirectShading STATIC
    Frontier/Engine/Rendering/DirectShading/SolarDepthRasterization.cpp
    Frontier/Engine/Rendering/DirectShading/SurfaceShadingRasterization.cpp
    Frontier/Engine/Rendering/DirectShading/DirectShadingSequence.cpp)
target_link_libraries(FrontierDirectShading PUBLIC FrontierGlobalIllumination)

# 📝 The units include the illumination port's scene layouts and intrinsics, so they compile with the same pinned compiler; without it
#    the editor uses EngineContent/ShaderArchives/DirectShading.
find_program(FRONTIER_GLOBAL_ILLUMINATION_SLANGC
    NAMES slangc
    PATHS "${CMAKE_SOURCE_DIR}/ExternalPackages/VulkanCompute/Slang/slangtorch/bin"
    NO_DEFAULT_PATH)
set(FRONTIER_DIRECT_SHADING_SHADER_SRC "${CMAKE_SOURCE_DIR}/Frontier/Engine/Shaders/DirectShading")
set(FRONTIER_DIRECT_SHADING_SHADER_OUT "${CMAKE_BINARY_DIR}/ShaderArchives/DirectShading")
file(GLOB FRONTIER_DIRECT_SHADING_SLANG_SOURCES CONFIGURE_DEPENDS "${FRONTIER_DIRECT_SHADING_SHADER_SRC}/*.slang"
     "${CMAKE_SOURCE_DIR}/Frontier/Engine/Shaders/GlobalIllumination/*.slang")

# Unit:Entry:Stage — one SPIR-V file per entry point, <Unit>.<Entry>.spv.
set(FRONTIER_DIRECT_SHADING_ENTRIES
    "SolarDepthRasterization:SolarDepthVertex:vertex"
    "SurfaceShadingRasterization:SkyVertex:vertex"
    "SurfaceShadingRasterization:SkyFragment:fragment"
    "SurfaceShadingRasterization:ShadingVertex:vertex"
    "SurfaceShadingRasterization:ShadingFragment:fragment")

set(FRONTIER_DIRECT_SHADING_SPV_OUTPUTS)
if(FRONTIER_GLOBAL_ILLUMINATION_SLANGC)
    foreach(ENTRY_SPEC IN LISTS FRONTIER_DIRECT_SHADING_ENTRIES)
        string(REPLACE ":" ";" ENTRY_PARTS "${ENTRY_SPEC}")
        list(GET ENTRY_PARTS 0 ENTRY_UNIT)
        list(GET ENTRY_PARTS 1 ENTRY_NAME)
        list(GET ENTRY_PARTS 2 ENTRY_STAGE)
        set(ENTRY_SPV "${FRONTIER_DIRECT_SHADING_SHADER_OUT}/${ENTRY_UNIT}.${ENTRY_NAME}.spv")
        list(APPEND FRONTIER_DIRECT_SHADING_SPV_OUTPUTS "${ENTRY_SPV}")
        add_custom_command(
            OUTPUT "${ENTRY_SPV}"
            COMMAND "${CMAKE_COMMAND}" -E make_directory "${FRONTIER_DIRECT_SHADING_SHADER_OUT}"
            COMMAND "${FRONTIER_GLOBAL_ILLUMINATION_SLANGC}" "${FRONTIER_DIRECT_SHADING_SHADER_SRC}/${ENTRY_UNIT}.slang"
                -I "${FRONTIER_DIRECT_SHADING_SHADER_SRC}"
                -I "${CMAKE_SOURCE_DIR}/Frontier/Engine/Shaders/GlobalIllumination"
                -entry "${ENTRY_NAME}"
                -stage "${ENTRY_STAGE}"
                -target spirv
                -profile spirv_1_3
                -emit-spirv-directly
                -matrix-layout-row-major
                -fvk-use-entrypoint-name
                -O0
                -o "${ENTRY_SPV}"
            DEPENDS ${FRONTIER_DIRECT_SHADING_SLANG_SOURCES}
            VERBATIM)
    endforeach()
    add_custom_target(FrontierDirectShadingShaders ALL DEPENDS ${FRONTIER_DIRECT_SHADING_SPV_OUTPUTS})
endif()

if(BUILD_TESTING)
    # 📝 Direct shading in the editor's scene viewport, offscreen (needs a Vulkan device; Exhibits/DirectShading).
    add_executable(DirectShadingCapture
        Exhibits/DirectShading/Code/DirectShadingCapture.cpp
        Engine/Render/StbImageWriteImplementation.cpp)
    target_include_directories(DirectShadingCapture PRIVATE "${CMAKE_SOURCE_DIR}/ExternalPackages/stb")
    target_link_libraries(DirectShadingCapture PRIVATE FrontierSceneViewport)
endif()
