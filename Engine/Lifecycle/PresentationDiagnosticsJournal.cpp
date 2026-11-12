/*============================================================================================================================================
                                                 PRESENTATIONDIAGNOSTICSJOURNAL.CPP
============================================================================================================================================*/
// 🧩 Dedicated journal thread persisting desktop Vulkan initialization and frame-presentation diagnostics

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Lifecycle/PresentationDiagnosticsJournal.h"

#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <utility>

namespace Frontier::Lifecycle
{

namespace
{

[[nodiscard]] std::string ConstructJournalTimestamp()
{
    const auto  CurrentTime = std::chrono::system_clock::now();
    const auto  TimePoint   = std::chrono::system_clock::to_time_t(CurrentTime);
    std::tm     CalendarTime {};

#if defined(_WIN32)
    localtime_s(&CalendarTime, &TimePoint);
#else
    localtime_r(&TimePoint, &CalendarTime);
#endif

    std::ostringstream Formatter {};
    Formatter << std::put_time(&CalendarTime, "%Y-%m-%d %H:%M:%S");
    return Formatter.str();
}

} // namespace

PresentationDiagnosticsJournal::~PresentationDiagnosticsJournal()
{
    Finalize();
}

void PresentationDiagnosticsJournal::Initialize(const std::filesystem::path& OutputDirectory)
{
    Finalize();

    std::error_code        DirectoryError {};
    std::filesystem::path  DestinationDirectory = OutputDirectory;
    std::filesystem::create_directories(DestinationDirectory, DirectoryError);
    if (DirectoryError)
    {
        DestinationDirectory = std::filesystem::current_path();
    }

    {
        std::lock_guard Guard(JournalMutex);
        OutputPath     = DestinationDirectory / "FrontierPresentationDiagnostics.log";
        IntakeEnabled  = true;
    }

    JournalThread = std::jthread([this](std::stop_token StopRequest)
    {
        WritePendingDiagnostics(StopRequest);
    });

    Append("Presentation diagnostics journal initialized.");
}

void PresentationDiagnosticsJournal::Append(std::string_view DiagnosticText)
{
    std::lock_guard Guard(JournalMutex);
    if (!IntakeEnabled)
    {
        return;
    }

    PendingDiagnostics.emplace_back("[" + ConstructJournalTimestamp() + "] " + std::string(DiagnosticText));
    PendingSignal.notify_one();
}

void PresentationDiagnosticsJournal::Finalize() noexcept
{
    {
        std::lock_guard Guard(JournalMutex);
        IntakeEnabled = false;
    }
    PendingSignal.notify_all();

    if (JournalThread.joinable())
    {
        JournalThread.request_stop();
        JournalThread.join();
    }
}

std::filesystem::path PresentationDiagnosticsJournal::QueryOutputPath() const
{
    std::lock_guard Guard(JournalMutex);
    return OutputPath;
}

void PresentationDiagnosticsJournal::WritePendingDiagnostics(std::stop_token StopRequest)
{
    std::filesystem::path JournalOutputPath {};
    {
        std::lock_guard Guard(JournalMutex);
        JournalOutputPath = OutputPath;
    }

    std::ofstream JournalFile(JournalOutputPath, std::ios::out | std::ios::trunc);
    if (!JournalFile)
    {
        return;
    }

    while (true)
    {
        std::deque<std::string> LocalDiagnostics {};
        bool                     ContinueIntake = false;

        {
            std::unique_lock Lock(JournalMutex);
            PendingSignal.wait(Lock, [this, StopRequest]
            {
                return !PendingDiagnostics.empty() || !IntakeEnabled || StopRequest.stop_requested();
            });
            LocalDiagnostics.swap(PendingDiagnostics);
            ContinueIntake = IntakeEnabled;
        }

        for (const std::string& Line : LocalDiagnostics)
        {
            JournalFile << Line << '\n';
        }
        JournalFile.flush();

        if (!ContinueIntake && LocalDiagnostics.empty())
        {
            break;
        }
        if (!ContinueIntake)
        {
            std::lock_guard Guard(JournalMutex);
            if (PendingDiagnostics.empty())
            {
                break;
            }
        }
    }
}

} // namespace Frontier::Lifecycle
