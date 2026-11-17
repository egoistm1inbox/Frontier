#============================================================================================================================================
#                                                       FLUIDSIMULATION.CMAKE
#============================================================================================================================================
# 🧩 GPU Eulerian fluid simulation, Slang compute archives, host-side source inputs, and numerical/coupling validation.

add_library(FrontierFluidDynamics STATIC
    Frontier/Engine/PhysicalDynamics/FluidDynamics/FluidSpace.cpp
    Frontier/Engine/Rendering/FluidSimulation/FluidSimulationSequence.cpp)
target_include_directories(FrontierFluidDynamics PUBLIC
    "${CMAKE_SOURCE_DIR}"
    "${CMAKE_SOURCE_DIR}/Frontier"
    "${CMAKE_SOURCE_DIR}/ExternalPackages/tomlpp/include")
target_link_libraries(FrontierFluidDynamics PUBLIC FrontierGlobalIllumination FrontierEnvironmentRendering)

find_program(FRONTIER_FLUID_SLANGC
    NAMES slangc
    PATHS "${CMAKE_SOURCE_DIR}/ExternalPackages/VulkanCompute/Slang/slangtorch/bin"
    NO_DEFAULT_PATH)
set(FRONTIER_FLUID_SHADER_SRC "${CMAKE_SOURCE_DIR}/Frontier/Engine/Shaders/FluidSimulation")
set(FRONTIER_FLUID_SHADER_OUT "${CMAKE_BINARY_DIR}/ShaderArchives/FluidSimulation")
file(GLOB FRONTIER_FLUID_SLANG_SOURCES CONFIGURE_DEPENDS "${FRONTIER_FLUID_SHADER_SRC}/*.slang")

# Module:Entry:Stage — every entry is a stand-alone Vulkan compute archive.
set(FRONTIER_FLUID_SHADER_ENTRIES
    "FluidForces:ApplyFluidForces:compute"
    "FluidAdvection:AdvectFluid:compute"
    "FluidDiffusion:DiffuseFluidScalars:compute"
    "FluidDivergence:ComputeFluidDivergence:compute"
    "FluidPressureSolve:SolveFluidPressure:compute"
    "FluidProjection:ProjectFluidPressure:compute"
    "FluidPreview:RenderFluidPreview:compute")

set(FRONTIER_FLUID_SPV_OUTPUTS)
if(FRONTIER_FLUID_SLANGC)
    foreach(ENTRY_SPEC IN LISTS FRONTIER_FLUID_SHADER_ENTRIES)
        string(REPLACE ":" ";" ENTRY_PARTS "${ENTRY_SPEC}")
        list(GET ENTRY_PARTS 0 ENTRY_UNIT)
        list(GET ENTRY_PARTS 1 ENTRY_NAME)
        list(GET ENTRY_PARTS 2 ENTRY_STAGE)
        set(ENTRY_SPV "${FRONTIER_FLUID_SHADER_OUT}/${ENTRY_UNIT}.${ENTRY_NAME}.spv")
        list(APPEND FRONTIER_FLUID_SPV_OUTPUTS "${ENTRY_SPV}")
        add_custom_command(
            OUTPUT "${ENTRY_SPV}"
            COMMAND "${CMAKE_COMMAND}" -E make_directory "${FRONTIER_FLUID_SHADER_OUT}"
            COMMAND "${FRONTIER_FLUID_SLANGC}" "${FRONTIER_FLUID_SHADER_SRC}/${ENTRY_UNIT}.slang"
                -I "${FRONTIER_FLUID_SHADER_SRC}"
                -entry "${ENTRY_NAME}"
                -stage "${ENTRY_STAGE}"
                -target spirv
                -profile spirv_1_3
                -emit-spirv-directly
                -matrix-layout-row-major
                -fvk-use-entrypoint-name
                -O0
                -o "${ENTRY_SPV}"
            DEPENDS ${FRONTIER_FLUID_SLANG_SOURCES}
            VERBATIM)
    endforeach()
    add_custom_target(FrontierFluidSimulationShaders ALL DEPENDS ${FRONTIER_FLUID_SPV_OUTPUTS})
    add_dependencies(FrontierFluidDynamics FrontierFluidSimulationShaders)
else()
    message(STATUS "Fluid GPU shaders: slangc not found; FluidSimulationGpuValidation is not registered")
endif()

if(BUILD_TESTING)
    add_executable(FluidSpaceValidation
        Exhibits/ParticleEditor/Code/FluidSpaceValidation.cpp)
    target_link_libraries(FluidSpaceValidation PRIVATE FrontierFluidDynamics)
    add_test(NAME FluidSpaceValidation COMMAND FluidSpaceValidation "${CMAKE_SOURCE_DIR}")
    set_tests_properties(FluidSpaceValidation PROPERTIES TIMEOUT 60)

    if(FRONTIER_FLUID_SLANGC)
        add_executable(FluidSimulationGpuValidation
            Exhibits/FluidEditor/Code/FluidSimulationGpuValidation.cpp)
        target_link_libraries(FluidSimulationGpuValidation PRIVATE FrontierFluidDynamics)
        add_test(NAME FluidSimulationGpuValidation COMMAND FluidSimulationGpuValidation
            "${CMAKE_SOURCE_DIR}" "${FRONTIER_FLUID_SHADER_OUT}")
        set_tests_properties(FluidSimulationGpuValidation PROPERTIES TIMEOUT 120 SKIP_RETURN_CODE 77)

        # 📝 When the pinned SwiftShader runtime is present, make the GPU validation deterministic and self-contained in CTest.
        set(FRONTIER_FLUID_SWIFTSHADER "${CMAKE_SOURCE_DIR}/ExternalPackages/VulkanCompute/SwiftShader")
        if(UNIX AND EXISTS "${FRONTIER_FLUID_SWIFTSHADER}/libvulkan.so.1" AND
           EXISTS "${FRONTIER_FLUID_SWIFTSHADER}/vk_swiftshader_icd.json")
            set_tests_properties(FluidSimulationGpuValidation PROPERTIES ENVIRONMENT
                "FRONTIER_VULKAN_DRIVER=${FRONTIER_FLUID_SWIFTSHADER}/libvulkan.so.1;VK_ICD_FILENAMES=${FRONTIER_FLUID_SWIFTSHADER}/vk_swiftshader_icd.json;LD_LIBRARY_PATH=${FRONTIER_FLUID_SWIFTSHADER}")
        endif()
    endif()
endif()
