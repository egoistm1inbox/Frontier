/*==========================================================================================================================================
                                                             JOLTEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Jolt's registration for the program, counted across every PhysicsSpace alive, and the stepping resources.

#include "Frontier/Extensions/Physics/JoltExtension.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <mutex>
#include <thread>

namespace Frontier
{

namespace
{

std::mutex& RegistrationLock()
{
    static std::mutex Lock;
    return Lock;
}

uint32_t& RegistrationCount()
{
    static uint32_t Count = 0;
    return Count;
}

} // namespace

JoltExtension::JoltExtension(uint32_t Workers)
{
    {
        std::lock_guard<std::mutex> Guard(RegistrationLock());
        if (RegistrationCount()++ == 0)
        {
            JPH::RegisterDefaultAllocator();
            JPH::Factory::sInstance = new JPH::Factory();
            JPH::RegisterTypes();
        }
    }
    const uint32_t Hardware = std::max(1u, std::thread::hardware_concurrency());
    Workers_                = Workers != 0 ? Workers : std::clamp(Hardware - 1u, 1u, 4u);
    Temporary               = std::make_unique<JPH::TempAllocatorImpl>(16u * 1024u * 1024u);
    Jobs = std::make_unique<JPH::JobSystemThreadPool>(JPH::cMaxPhysicsJobs, JPH::cMaxPhysicsBarriers, static_cast<int>(Workers_));
}

JoltExtension::~JoltExtension()
{
    Jobs.reset();
    Temporary.reset();
    std::lock_guard<std::mutex> Guard(RegistrationLock());
    if (--RegistrationCount() == 0)
    {
        JPH::UnregisterTypes();
        delete JPH::Factory::sInstance;
        JPH::Factory::sInstance = nullptr;
    }
}

} // namespace Frontier
