cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierPathReplay LANGUAGES CXX)
endif()

if(TARGET FrontierAtmosphericOptics)
    return()
endif()

# 📝 Atmospheric scattering, celestial ephemeris, clouds, height fog, weather, and solar lens-flare optics.
add_library(FrontierAtmosphericOptics STATIC
    AtmosphereModel.cpp
    CelestialModel.cpp
    CloudField.cpp
    FogMedium.cpp
    WeatherEffects.cpp)
target_compile_features(FrontierAtmosphericOptics PUBLIC cxx_std_20)
target_include_directories(FrontierAtmosphericOptics PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierAtmosphericOptics PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierAtmosphericOptics PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Typed shader inputs do not provide Vulkan submission or editor integration.
add_library(FrontierMediumRadiancePayload STATIC MediumRadiancePayload.cpp)
target_compile_features(FrontierMediumRadiancePayload PUBLIC cxx_std_17)
target_include_directories(FrontierMediumRadiancePayload PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierMediumRadiancePayload PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierMediumRadiancePayload PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Float32 source distribution is shared by surface and fog transport; submission remains separate.
add_library(FrontierRadiantFacetDistribution STATIC RadiantFacetDistribution.cpp)
target_compile_features(FrontierRadiantFacetDistribution PUBLIC cxx_std_17)
target_include_directories(FrontierRadiantFacetDistribution PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierRadiantFacetDistribution PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierRadiantFacetDistribution PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Cone-sphere-box analytic luminaire clustering, Type-C LM-63 Emissive-IES, and 3D radiant facet importance grids.
add_library(FrontierPhotometricLights STATIC PhotometricLights.cpp)
target_compile_features(FrontierPhotometricLights PUBLIC cxx_std_20)
target_link_libraries(FrontierPhotometricLights PUBLIC FrontierRadiantFacetDistribution)
target_include_directories(FrontierPhotometricLights PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierPhotometricLights PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierPhotometricLights PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Coupled solar/sky/cloud payload and double-precision reference quadrature.
add_library(FrontierSkyRadiance STATIC SkyRadiance.cpp)
target_compile_features(FrontierSkyRadiance PUBLIC cxx_std_20)
target_link_libraries(FrontierSkyRadiance PUBLIC FrontierAtmosphericOptics)
target_include_directories(FrontierSkyRadiance PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierSkyRadiance PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierSkyRadiance PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Reusable bounded replay-domain intake; shader submission and editor wiring are separate work.
add_library(FrontierPathReplayDomain STATIC PathReplayDomain.cpp)
target_compile_features(FrontierPathReplayDomain PUBLIC cxx_std_20)
target_link_libraries(FrontierPathReplayDomain PUBLIC FrontierSkyRadiance FrontierPhotometricLights)
target_include_directories(FrontierPathReplayDomain PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierPathReplayDomain PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierPathReplayDomain PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Optional caller-owned Vulkan path-replay recorder; pipelines, descriptors and queue remain external.
if(FRONTIER_RENDERING_VULKAN_HEADERS)
    add_library(FrontierPathReplayVulkan STATIC PathReplayVulkan.cpp PathReplayRayQuery.cpp)
    target_compile_features(FrontierPathReplayVulkan PUBLIC cxx_std_17)
    target_include_directories(FrontierPathReplayVulkan PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../.."
        "${FRONTIER_RENDERING_VULKAN_HEADERS}")
    if(MSVC)
        target_compile_options(FrontierPathReplayVulkan PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierPathReplayVulkan PRIVATE -Wall -Wextra -Werror)
    endif()
    # 📝 Optional single-in-flight history sequencing; resource ownership and queue completion remain external.
    add_library(FrontierPathReplaySubmission STATIC PathReplaySubmissionSequence.cpp)
    target_compile_features(FrontierPathReplaySubmission PUBLIC cxx_std_20)
    target_link_libraries(FrontierPathReplaySubmission PUBLIC FrontierPathReplayDomain FrontierPathReplayVulkan)
    if(MSVC)
        target_compile_options(FrontierPathReplaySubmission PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierPathReplaySubmission PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 Matched face-flux gas projection parameters; shader submission and advection remain separate.
add_library(FrontierGasProjectionFootprint INTERFACE)
target_compile_features(FrontierGasProjectionFootprint INTERFACE cxx_std_17)
target_include_directories(FrontierGasProjectionFootprint INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/../..")

# 📝 Typed plume input footprints and validation, without a renderer or GPU submission.
add_library(FrontierPlumeLatticeFootprint STATIC PlumeLatticeFootprint.cpp)
target_compile_features(FrontierPlumeLatticeFootprint PUBLIC cxx_std_17)
target_include_directories(FrontierPlumeLatticeFootprint PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierPlumeLatticeFootprint PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierPlumeLatticeFootprint PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Domain simulation & geometry modules live in Frontier/Engine/Fluid, Environment, Geometry, and Physics.
if(NOT TARGET FrontierPlumeFluid)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Fluid" "${CMAKE_CURRENT_BINARY_DIR}/FrontierFluid")
endif()
if(NOT TARGET FrontierWindField)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../VisualEffects" "${CMAKE_CURRENT_BINARY_DIR}/FrontierEnvironment")
endif()
if(NOT TARGET FrontierGeometryProcessing)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../GeometryProcessing" "${CMAKE_CURRENT_BINARY_DIR}/FrontierGeometry")
endif()
if(NOT TARGET FrontierSolidFracture)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Physics/Fracture" "${CMAKE_CURRENT_BINARY_DIR}/FrontierFracture")
endif()
if(NOT TARGET FrontierParticles)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Particles" "${CMAKE_CURRENT_BINARY_DIR}/FrontierSparks")
endif()

# 📝 Dual-tier GTX (SDF GI + BVH Triangle Reflections), RTX (Full Raytracing), Blinn Low-Res & Protected Auto-Exposure.
if(NOT TARGET FrontierSceneRenderer)
    add_library(FrontierSceneRenderer STATIC
        BlinnRenderer.cpp
        DiscrepancySequence.cpp
        DistanceField.cpp
        ExposureAdaptation.cpp
        SceneRenderer.cpp)
    target_compile_features(FrontierSceneRenderer PUBLIC cxx_std_20)
    target_link_libraries(FrontierSceneRenderer PUBLIC
        FrontierAtmosphericOptics
        FrontierCelestialSky
        FrontierGeometryProcessing
        FrontierPlumeFluid
        FrontierShallowWater
        FrontierSnowLightning
        FrontierParticles)
    target_include_directories(FrontierSceneRenderer PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierSceneRenderer PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierSceneRenderer PRIVATE -Wall -Wextra -Werror)
    endif()
endif()

# 📝 Unified FrameGraph compiler (SubmissionOrder + BarrierDerivation + TransientTargetAtlas), parallel recorder & RenderThread.
if(TARGET FrontierThreading)
    add_library(FrontierFrameGraphRuntime STATIC
        SubmissionOrder.cpp
        BarrierDerivation.cpp
        TransientTargetAtlas.cpp
        FrameGraphExecution.cpp
        ../Diagnostics/LogCategories.cpp
        ../Diagnostics/LogRingStore.cpp
        ../Diagnostics/LogStream.cpp)
    target_compile_features(FrontierFrameGraphRuntime PUBLIC cxx_std_20)
    target_link_libraries(FrontierFrameGraphRuntime PUBLIC FrontierThreading)
    target_include_directories(FrontierFrameGraphRuntime PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierFrameGraphRuntime PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierFrameGraphRuntime PRIVATE -Wall -Wextra -Werror)
    endif()
endif()
