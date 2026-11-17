/*==========================================================================================================================================
                                                   PHOTOMETRICIESFILEDIALOG.H
==========================================================================================================================================*/
// 📝 Native LM-63 file picker when provided by the host; other platforms use the workspace path field.

#pragma once

#include <string>

namespace Frontier
{

[[nodiscard]] std::string BrowsePhotometricIesFile();
[[nodiscard]] bool PhotometricIesFileDialogAvailable() noexcept;

} // namespace Frontier
