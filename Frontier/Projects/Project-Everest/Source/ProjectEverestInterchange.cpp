/*==========================================================================================================================================
                                                     PROJECTEVERESTINTERCHANGE.CPP
==========================================================================================================================================*/
// 🧩 Project Everest interchange entry point registering structured subsystem diagnostics in LogStream.

#include "Engine/Diagnostics/LogStream.h"
#include "Engine/Projects/ProjectInterchange.h"

namespace
{

class ProjectEverestRuntime final
{
  public:
    Frontier::LogCategory Illumination{};
    Frontier::LogCategory Drivetrain{};
    Frontier::LogCategory TyreContact{};
    Frontier::LogCategory Atmosphere{};
    Frontier::LogCategory Destruction{};
    uint64_t              TickCounter = 0;
};

bool StartEverest(void *Context, const Frontier::EngineInterchangeTable *Engine)
{
    auto *Runtime = static_cast<ProjectEverestRuntime *>(Context);
    if (Runtime == nullptr || Engine == nullptr)
    {
        return false;
    }
    Runtime->Illumination = Frontier::RegisterLogCategory("Illumination", Frontier::LogColour::Mint);
    Runtime->Drivetrain   = Frontier::RegisterLogCategory("Drivetrain", Frontier::LogColour::Amber);
    Runtime->TyreContact  = Frontier::RegisterLogCategory("TyreContact", Frontier::LogColour::Blue);
    Runtime->Atmosphere   = Frontier::RegisterLogCategory("Atmosphere", Frontier::LogColour::Purple);
    Runtime->Destruction  = Frontier::RegisterLogCategory("Destruction", Frontier::LogColour::Pink);
    Frontier::WriteLog(Runtime->Illumination.Token, Frontier::LogSeverity::Info, Frontier::LogVerbosity::Display,
                       "Project Everest initialized \xC2\xB7 dual-tier RTX RayQuery ReSTIR + GTX SDF/BVH ready",
                       "ProjectEverestInterchange.cpp");
    return true;
}

void AdvanceEverest(void *Context, double)
{
    auto *Runtime = static_cast<ProjectEverestRuntime *>(Context);
    if (Runtime != nullptr)
    {
        ++Runtime->TickCounter;
    }
}

void ShutdownEverest(void *Context)
{
    delete static_cast<ProjectEverestRuntime *>(Context);
}

} // namespace

extern "C" FRONTIER_PROJECT_EXPORT bool ConstructProjectInterchange(Frontier::ProjectInterchangeContract *Contract)
{
    if (Contract == nullptr)
    {
        return false;
    }
    auto *Runtime                    = new ProjectEverestRuntime();
    Contract->InterchangeNumber      = Frontier::CodeInterchangeNumberCurrent;
    Contract->InterfaceFingerprint   = Frontier::InterfaceFingerprintCurrent;
    Contract->ProjectContext         = Runtime;
    Contract->Start                  = &StartEverest;
    Contract->Advance                = &AdvanceEverest;
    Contract->Shutdown               = &ShutdownEverest;
    return true;
}
