/*============================================================================================================================================
                                                  PRESENTATIONDIAGNOSTICSJOURNAL.H
============================================================================================================================================*/
// 🧩 Dedicated journal thread persisting desktop Vulkan initialization and frame-presentation diagnostics

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include <condition_variable>
#include <deque>
#include <filesystem>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>

namespace Frontier::Lifecycle
{

class PresentationDiagnosticsJournal
{
public:
    PresentationDiagnosticsJournal() = default;
    ~PresentationDiagnosticsJournal();

    PresentationDiagnosticsJournal(const PresentationDiagnosticsJournal&)            = delete;
    PresentationDiagnosticsJournal& operator=(const PresentationDiagnosticsJournal&) = delete;

    void Initialize(const std::filesystem::path& OutputDirectory);
    void Append(std::string_view DiagnosticText);
    void Finalize() noexcept;

    [[nodiscard]] std::filesystem::path QueryOutputPath() const;

private:
    void WritePendingDiagnostics(std::stop_token StopRequest);

    mutable std::mutex              JournalMutex       {};
    std::condition_variable         PendingSignal      {};
    std::deque<std::string>         PendingDiagnostics {};
    std::filesystem::path           OutputPath         {};
    std::jthread                    JournalThread      {};
    bool                            IntakeEnabled      = false;
};

} // namespace Frontier::Lifecycle
