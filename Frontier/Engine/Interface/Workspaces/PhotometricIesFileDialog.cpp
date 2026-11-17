/*==========================================================================================================================================
                                                   PHOTOMETRICIESFILEDIALOG.CPP
==========================================================================================================================================*/
// 📝 Windows Open dialog for Type-C .ies files. Linux/headless hosts use the workspace's editable path field.

#include "Frontier/Engine/Interface/Workspaces/PhotometricIesFileDialog.h"

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <commdlg.h>
#include <vector>
#endif

namespace Frontier
{

std::string BrowsePhotometricIesFile()
{
#if defined(_WIN32)
    std::vector<wchar_t> Chosen(32768, L'\0');
    OPENFILENAMEW Request{};
    Request.lStructSize = sizeof(Request);
    Request.hwndOwner = GetActiveWindow();
    Request.lpstrFilter = L"IES photometric profiles (*.ies)\0*.ies\0All files (*.*)\0*.*\0";
    Request.lpstrFile = Chosen.data();
    Request.nMaxFile = static_cast<DWORD>(Chosen.size());
    Request.lpstrTitle = L"Load LM-63 Type-C photometric profile";
    Request.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER;
    if (!GetOpenFileNameW(&Request)) return {};

    const int Required = WideCharToMultiByte(CP_UTF8, 0, Chosen.data(), -1, nullptr, 0, nullptr, nullptr);
    if (Required <= 1) return {};
    std::string Utf8(static_cast<size_t>(Required), '\0');
    if (WideCharToMultiByte(CP_UTF8, 0, Chosen.data(), -1, Utf8.data(), Required, nullptr, nullptr) != Required) return {};
    Utf8.pop_back();
    return Utf8;
#else
    return {};
#endif
}

bool PhotometricIesFileDialogAvailable() noexcept
{
#if defined(_WIN32)
    return true;
#else
    return false;
#endif
}

} // namespace Frontier
