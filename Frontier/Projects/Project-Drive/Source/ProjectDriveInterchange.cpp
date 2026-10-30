//============================================================================================================================================
//                                                     PROJECTDRIVEINTERCHANGE.CPP
//============================================================================================================================================
// 🧩 Project-Drive v3 code image: owns the Jolt proving ground and ControlVehicle simulation behind the host C ABI.

#include "DriveSimulation.h"

#include <ProjectInterchange.h>

#include <algorithm>
#include <chrono>
#include <cstdio>

namespace
{

using SteadyTime = std::chrono::steady_clock::time_point;

FrontierHostInterchange          Host          = {};
bool                             HostConnected = false;
Frontier::Drive::DriveSimulation Simulation;
SteadyTime                       LastAdvance   = {};

void PublishDiagnostic(const char* SubjectName, const char* Explanation)
{
    if (!HostConnected || Host.ReceiveDiagnostic == nullptr)
    {
        return;
    }
    FrontierProjectDiagnostic Diagnostic = {};
    Diagnostic.StructureSize             = sizeof(Diagnostic);
    Diagnostic.SubjectName               = SubjectName;
    Diagnostic.Explanation               = Explanation;
    Host.ReceiveDiagnostic(&Diagnostic, Host.ProjectReception);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 INTERCHANGE FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

bool FRONTIER_CODE_IMAGE_CALL ConstructProject(
    const FrontierHostInterchange* HostInterchange,
    void*                          ProjectReception)
{
    if (HostInterchange == nullptr ||
        HostInterchange->StructureSize < sizeof(*HostInterchange) ||
        HostInterchange->ReceiveDiagnostic == nullptr)
    {
        return false;
    }

    Host          = *HostInterchange;
    HostConnected = true;
    (void)ProjectReception;

    if (!Simulation.Bring())
    {
        PublishDiagnostic("ProjectDrive/Telemetry", "Project-Drive failed to bring up Jolt proving ground");
        HostConnected = false;
        return false;
    }

    LastAdvance = std::chrono::steady_clock::now();

    const Frontier::Drive::DriveSnapshot Initial = Simulation.TakeSnapshot(1280u, 720u);
    char                                 Line[256] = {};
    std::snprintf(
        Line,
        sizeof(Line),
        "Project-Drive constructed · %s · bodies %u · spawn CoM Z=%.3f m",
        Frontier::RigidBodySolver::QueryJoltVersion(),
        Simulation.QueryWorld().QueryMetrics().BodyCount,
        Initial.Telemetry.Chassis.Position.z);
    PublishDiagnostic("ProjectDrive/Telemetry", Line);
    return true;
}

void FRONTIER_CODE_IMAGE_CALL AdvanceProject()
{
    if (!Simulation.Active())
    {
        return;
    }

    const SteadyTime Now     = std::chrono::steady_clock::now();
    const double     RawStep = std::chrono::duration<double>(Now - LastAdvance).count();
    LastAdvance              = Now;

    const double ClampedStep = std::clamp(RawStep, 1.0 / 240.0, 0.1);
    Simulation.Advance(ClampedStep);

    const Frontier::Drive::DriveSnapshot Current = Simulation.TakeSnapshot(1280u, 720u);
    if ((Current.FrameIndex % 60u) == 0u)
    {
        char Line[256] = {};
        std::snprintf(
            Line,
            sizeof(Line),
            "Frame %llu · speed %.2f m/s · gear %d · %.0f rpm · contacts %u/4",
            static_cast<unsigned long long>(Current.FrameIndex),
            Current.Telemetry.SpeedMetresPerSecond,
            Current.Telemetry.GearIndex,
            Current.Telemetry.EngineRPM,
            Current.Telemetry.WheelsInContact);
        PublishDiagnostic("ProjectDrive/Drivetrain", Line);
    }
}

void FRONTIER_CODE_IMAGE_CALL RetireProject()
{
    Simulation.Retire();
    PublishDiagnostic("ProjectDrive/Telemetry", "Project-Drive retired by host");
    HostConnected = false;
}

} // namespace

#if defined(_WIN32)
    #define FRONTIER_DRIVE_EXPORT
#else
    #define FRONTIER_DRIVE_EXPORT __attribute__((visibility("default")))
#endif

extern "C"
{

FRONTIER_DRIVE_EXPORT bool FRONTIER_CODE_IMAGE_CALL ConstructProjectInterchange(
    uint32_t                    InterchangeNumber,
    uint64_t                    InterfaceFingerprint,
    FrontierProjectInterchange* InterchangeDelivery,
    char*                       RefusalExplanation,
    size_t                      RefusalExplanationCapacity)
{
    const auto Refuse = [&](const char* Explanation) -> bool {
        if (RefusalExplanation != nullptr && RefusalExplanationCapacity > 0u)
        {
            std::snprintf(RefusalExplanation, RefusalExplanationCapacity, "%s", Explanation);
        }
        return false;
    };

    if (InterchangeDelivery == nullptr ||
        InterchangeDelivery->StructureSize < sizeof(FrontierProjectInterchange))
    {
        return Refuse("Interchange delivery record is missing or undersized.");
    }
    if (InterchangeNumber != FRONTIER_CODE_INTERCHANGE_NUMBER)
    {
        return Refuse("Project-Drive does not implement the requested code interchange number.");
    }
    if (InterfaceFingerprint != FRONTIER_INTERFACE_FINGERPRINT)
    {
        return Refuse("Project-Drive interface fingerprint does not match the host.");
    }

    InterchangeDelivery->ConstructProject = &ConstructProject;
    InterchangeDelivery->AdvanceProject   = &AdvanceProject;
    InterchangeDelivery->RetireProject    = &RetireProject;
    return true;
}

} // extern "C"
