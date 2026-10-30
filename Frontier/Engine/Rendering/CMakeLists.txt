cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierPathReplay LANGUAGES CXX)
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
add_library(FrontierPhotometricClustering STATIC PhotometricClusterExtension.cpp)
target_compile_features(FrontierPhotometricClustering PUBLIC cxx_std_20)
target_link_libraries(FrontierPhotometricClustering PUBLIC FrontierRadiantFacetDistribution)
target_include_directories(FrontierPhotometricClustering PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierPhotometricClustering PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierPhotometricClustering PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Coupled solar/sky/cloud payload and double-precision reference quadrature.
add_library(FrontierSolarSkyEnvironmentPayload STATIC SolarSkyEnvironmentPayload.cpp)
target_compile_features(FrontierSolarSkyEnvironmentPayload PUBLIC cxx_std_20)
target_link_libraries(FrontierSolarSkyEnvironmentPayload PUBLIC FrontierAtmosphericOptics)
target_include_directories(FrontierSolarSkyEnvironmentPayload PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierSolarSkyEnvironmentPayload PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierSolarSkyEnvironmentPayload PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Reusable bounded replay-domain intake; shader submission and editor wiring are separate work.
add_library(FrontierPathReplayDomain STATIC PathReplayDomain.cpp)
target_compile_features(FrontierPathReplayDomain PUBLIC cxx_std_20)
target_link_libraries(FrontierPathReplayDomain PUBLIC FrontierSolarSkyEnvironmentPayload FrontierPhotometricClustering)
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

# 📝 Domain simulation modules live in Frontier/Engine/Fluid, Environment, and Physics (never inside Rendering).
if(NOT TARGET FrontierPlumeFluid)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Fluid" "${CMAKE_CURRENT_BINARY_DIR}/FrontierFluid")
endif()
if(NOT TARGET FrontierWindForceField)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Environment" "${CMAKE_CURRENT_BINARY_DIR}/FrontierEnvironment")
endif()
if(NOT TARGET FrontierSolidFracture)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Physics/Fracture" "${CMAKE_CURRENT_BINARY_DIR}/FrontierFracture")
endif()
if(NOT TARGET FrontierBallisticSparks)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../Physics/Sparks" "${CMAKE_CURRENT_BINARY_DIR}/FrontierSparks")
endif()

# 📝 Dual-tier GTX SDF + SurfaceCards and RTX BVH ReSTIR extension with Portals, Mirrors & full volumetric reflections.
if(NOT TARGET FrontierSdfRestirPortal)
    add_library(FrontierSdfRestirPortal STATIC
        DiscrepancySequence.cpp
        DistanceField.cpp
        SdfRestirPortalExtension.cpp)
    target_compile_features(FrontierSdfRestirPortal PUBLIC cxx_std_20)
    target_link_libraries(FrontierSdfRestirPortal PUBLIC
        FrontierAtmosphericOptics
        FrontierPlumeFluid
        FrontierShallowWaterMud
        FrontierSnowLightningEnvironment
        FrontierBallisticSparks)
    target_include_directories(FrontierSdfRestirPortal PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
    if(MSVC)
        target_compile_options(FrontierSdfRestirPortal PRIVATE /utf-8 /W4)
    else()
        target_compile_options(FrontierSdfRestirPortal PRIVATE -Wall -Wextra -Werror)
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
