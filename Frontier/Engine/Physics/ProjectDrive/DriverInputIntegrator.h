//============================================================================================================================================
//                                                       DRIVERINPUTINTEGRATOR.H
//============================================================================================================================================
// 🧩 Device-neutral driver command integrator: ramps discrete keys, shapes analog axes, and latches transmission/reset pulses.

#pragma once

#include "VehicleSolver.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Vehicle
{

enum class InputDeviceCategory
{
    Keyboard,
    Gamepad,
    Wheel
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   INPUT CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct InputConfiguration
{
    float SteeringSensitivity   = 1.0f;     // [-]   - Scale applied to resolved steering command
    float ThrottleSensitivity   = 1.0f;     // [-]   - Scale applied to resolved throttle command
    float BrakeSensitivity      = 1.0f;     // [-]   - Scale applied to resolved brake command
    float SteeringDeadZone      = 0.05f;    // [-]   - Symmetric analog steering dead-zone around centre
    float ThrottleDeadZone      = 0.02f;    // [-]   - Analog throttle pedal dead-zone at rest
    float BrakeDeadZone         = 0.02f;    // [-]   - Analog brake pedal dead-zone at rest
    float ThrottleRiseRate      = 3.0f;     // [1/s] - Digital throttle build rate
    float ThrottleFallRate      = 6.0f;     // [1/s] - Digital throttle release rate
    float BrakeRiseRate         = 4.0f;     // [1/s] - Digital brake build rate
    float BrakeFallRate         = 8.0f;     // [1/s] - Digital brake release rate
    float SteerRate             = 3.5f;     // [1/s] - Digital steering build rate toward +/-1
    float SteerReturnRate       = 5.0f;     // [1/s] - Digital steering self-centring rate
    float SteeringLinearity     = 1.0f;     // [-]   - Analog steering exponent (>1 refines centre sensitivity)
    float WheelRotationRange    = 900.0f;   // [deg] - Physical lock-to-lock wheel rotation span
    float ForceFeedbackStrength = 0.7f;     // [0,1] - Force-feedback gain metadata
    float DeviceSwitchThreshold = 0.1f;     // [-]   - Activity threshold for host device switching
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     DRIVER COMMAND
//------------------------------------------------------------------------------------------------------------------------

struct DriverCommand
{
    DriverInput Drive        {};      // [-] - Normalised throttle, brake, steer, and handbrake
    bool        ShiftUp      = false; // [-] - Sequential up-shift pulse latched this frame
    bool        ShiftDown    = false; // [-] - Sequential down-shift pulse latched this frame
    int         SelectedGear = -1;    // [-] - Direct H-pattern gear request (-1 when idle)
    bool        ResetVehicle = false; // [-] - Respawn pulse latched this frame
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 DRIVER INPUT INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

class DriverInputIntegrator
{
  public:
    explicit DriverInputIntegrator(const InputConfiguration& InitialConfiguration = {}) noexcept
        : ActiveConfiguration(InitialConfiguration)
    {
    }

    void AssignConfiguration(const InputConfiguration& RequestedConfiguration) noexcept
    {
        ActiveConfiguration = RequestedConfiguration;
    }

    [[nodiscard]] const InputConfiguration& Configuration() const noexcept
    {
        return ActiveConfiguration;
    }

    void AssignDevice(InputDeviceCategory Device) noexcept
    {
        SelectedDevice = Device;
    }

    [[nodiscard]] InputDeviceCategory ActiveDevice() const noexcept
    {
        return SelectedDevice;
    }

    void ForwardThrottleKey(bool Down) noexcept { ThrottleKeyDown = Down; }
    void ForwardBrakeKey(bool Down) noexcept { BrakeKeyDown = Down; }
    void ForwardSteerLeftKey(bool Down) noexcept { SteerLeftKeyDown = Down; }
    void ForwardSteerRightKey(bool Down) noexcept { SteerRightKeyDown = Down; }
    void ForwardHandbrakeKey(bool Down) noexcept { HandbrakeKeyDown = Down; }

    void ForwardThrottleAxis(float Reading) noexcept
    {
        ThrottleAxisRaw     = Reading;
        AnalogPedalsPresent = true;
    }

    void ForwardBrakeAxis(float Reading) noexcept
    {
        BrakeAxisRaw        = Reading;
        AnalogPedalsPresent = true;
    }

    void ForwardSteerAxis(float Reading) noexcept
    {
        SteerAxisRaw       = Reading;
        AnalogSteerPresent = true;
    }

    void ForwardHandbrakeAxis(float Reading) noexcept
    {
        HandbrakeAxisRaw = Reading;
    }

    void ForwardWheelAngle(float Degrees) noexcept
    {
        SteerAxisRaw       = ClampRange(Degrees / (0.5f * ActiveConfiguration.WheelRotationRange), -1.0f, 1.0f);
        AnalogSteerPresent = true;
    }

    void ShiftUp() noexcept { ShiftUpPending = true; }
    void ShiftDown() noexcept { ShiftDownPending = true; }
    void SelectGear(int Gear) noexcept { PendingGear = Gear; }
    void RequestReset() noexcept { ResetPending = true; }

    void ReleaseControls() noexcept
    {
        ThrottleKeyDown     = false;
        BrakeKeyDown        = false;
        SteerLeftKeyDown    = false;
        SteerRightKeyDown   = false;
        HandbrakeKeyDown    = false;
        ThrottleAxisRaw     = 0.0f;
        BrakeAxisRaw        = 0.0f;
        SteerAxisRaw        = 0.0f;
        HandbrakeAxisRaw    = 0.0f;
        ThrottleSmoothed    = 0.0f;
        BrakeSmoothed       = 0.0f;
        SteerSmoothed       = 0.0f;
        ShiftUpPending      = false;
        ShiftDownPending    = false;
        ResetPending        = false;
        PendingGear         = -1;
    }

    [[nodiscard]] DriverCommand Advance(float Δτ) noexcept
    {
        Δτ = std::max(0.0f, Δτ);
        DriverCommand Command;

        if (SelectedDevice == InputDeviceCategory::Keyboard || (!AnalogPedalsPresent && !AnalogSteerPresent))
        {
            ThrottleSmoothed = RampTowards(
                ThrottleSmoothed,
                ThrottleKeyDown ? 1.0f : 0.0f,
                ActiveConfiguration.ThrottleRiseRate,
                ActiveConfiguration.ThrottleFallRate,
                Δτ);
            BrakeSmoothed = RampTowards(
                BrakeSmoothed,
                BrakeKeyDown ? 1.0f : 0.0f,
                ActiveConfiguration.BrakeRiseRate,
                ActiveConfiguration.BrakeFallRate,
                Δτ);

            const float SteerTarget = (SteerLeftKeyDown ? 1.0f : 0.0f) - (SteerRightKeyDown ? 1.0f : 0.0f);
            if (SteerLeftKeyDown || SteerRightKeyDown)
            {
                SteerSmoothed += (SteerTarget - SteerSmoothed) * std::min(1.0f, Δτ * ActiveConfiguration.SteerRate);
            }
            else
            {
                SteerSmoothed += (0.0f - SteerSmoothed) * std::min(1.0f, Δτ * ActiveConfiguration.SteerReturnRate);
            }

            Command.Drive.Throttle  = ClampRange(ThrottleSmoothed * ActiveConfiguration.ThrottleSensitivity, 0.0f, 1.0f);
            Command.Drive.Brake     = ClampRange(BrakeSmoothed * ActiveConfiguration.BrakeSensitivity, 0.0f, 1.0f);
            Command.Drive.Steer     = ClampRange(SteerSmoothed * ActiveConfiguration.SteeringSensitivity, -1.0f, 1.0f);
            Command.Drive.Handbrake = HandbrakeKeyDown;
        }
        else
        {
            const float ThrottleSample = ApplyDeadZone(ThrottleAxisRaw, ActiveConfiguration.ThrottleDeadZone);
            const float BrakeSample    = ApplyDeadZone(BrakeAxisRaw, ActiveConfiguration.BrakeDeadZone);
            float       SteerSample    = ApplyDeadZone(SteerAxisRaw, ActiveConfiguration.SteeringDeadZone);

            if (ActiveConfiguration.SteeringLinearity != 1.0f)
            {
                SteerSample = std::copysign(
                    std::pow(std::fabs(SteerSample), ActiveConfiguration.SteeringLinearity), SteerSample);
            }

            ThrottleSmoothed        = ThrottleSample;
            BrakeSmoothed           = BrakeSample;
            SteerSmoothed           = SteerSample;
            Command.Drive.Throttle  = ClampRange(ThrottleSample * ActiveConfiguration.ThrottleSensitivity, 0.0f, 1.0f);
            Command.Drive.Brake     = ClampRange(BrakeSample * ActiveConfiguration.BrakeSensitivity, 0.0f, 1.0f);
            Command.Drive.Steer     = ClampRange(SteerSample * ActiveConfiguration.SteeringSensitivity, -1.0f, 1.0f);
            Command.Drive.Handbrake = (HandbrakeAxisRaw > 0.5f) || HandbrakeKeyDown;
        }

        Command.ShiftUp      = ShiftUpPending;
        Command.ShiftDown    = ShiftDownPending;
        Command.SelectedGear = PendingGear;
        Command.ResetVehicle = ResetPending;

        ShiftUpPending   = false;
        ShiftDownPending = false;
        ResetPending     = false;
        PendingGear      = -1;
        return Command;
    }

  private:
    [[nodiscard]] static float ClampRange(float Quantity, float Lower, float Upper) noexcept
    {
        return Quantity < Lower ? Lower : (Quantity > Upper ? Upper : Quantity);
    }

    [[nodiscard]] static float RampTowards(float Current, float Target, float RiseRate, float FallRate, float Δτ) noexcept
    {
        const float Rate = (Target > Current) ? RiseRate : FallRate;
        const float Step = Rate * Δτ;
        if (std::fabs(Target - Current) <= Step)
        {
            return Target;
        }
        return Current + std::copysign(Step, Target - Current);
    }

    [[nodiscard]] static float ApplyDeadZone(float Sample, float DeadZoneWidth) noexcept
    {
        const float Magnitude = std::fabs(Sample);
        if (Magnitude <= DeadZoneWidth)
        {
            return 0.0f;
        }
        return std::copysign((Magnitude - DeadZoneWidth) / (1.0f - DeadZoneWidth), Sample);
    }

    InputConfiguration  ActiveConfiguration {};
    InputDeviceCategory SelectedDevice      = InputDeviceCategory::Keyboard;

    bool ThrottleKeyDown   = false;
    bool BrakeKeyDown      = false;
    bool SteerLeftKeyDown  = false;
    bool SteerRightKeyDown = false;
    bool HandbrakeKeyDown  = false;

    float ThrottleAxisRaw     = 0.0f;
    float BrakeAxisRaw        = 0.0f;
    float SteerAxisRaw        = 0.0f;
    float HandbrakeAxisRaw    = 0.0f;
    bool  AnalogPedalsPresent = false;
    bool  AnalogSteerPresent  = false;

    float ThrottleSmoothed = 0.0f;
    float BrakeSmoothed    = 0.0f;
    float SteerSmoothed    = 0.0f;

    bool ShiftUpPending   = false;
    bool ShiftDownPending = false;
    bool ResetPending     = false;
    int  PendingGear      = -1;
};

} // namespace Frontier::Vehicle
