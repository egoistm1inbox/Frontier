/*==========================================================================================================================================
                                                           PHOTOMETRICIES.CPP
==========================================================================================================================================*/
// 📝 Bounded LM-63 Type-C parser with candela symmetry expansion and a normalized periodic sampling atlas.

#include "Frontier/Engine/Photometry/PhotometricIes.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <string>
#include <utility>

namespace Frontier
{
namespace
{

constexpr double AngleTolerance = 1.0e-6;
constexpr double HalfTurnDeg = 180.0;
constexpr double FullTurnDeg = 360.0;

std::string_view Trim(std::string_view Text) noexcept
{
    while (!Text.empty() && std::isspace(static_cast<unsigned char>(Text.front()))) Text.remove_prefix(1);
    while (!Text.empty() && std::isspace(static_cast<unsigned char>(Text.back()))) Text.remove_suffix(1);
    return Text;
}

char UpperAscii(char Character) noexcept
{
    return Character >= 'a' && Character <= 'z' ? static_cast<char>(Character - ('a' - 'A')) : Character;
}

bool EqualsAsciiInsensitive(std::string_view A, std::string_view B) noexcept
{
    if (A.size() != B.size()) return false;
    for (size_t Index = 0; Index < A.size(); ++Index)
        if (UpperAscii(A[Index]) != UpperAscii(B[Index])) return false;
    return true;
}

std::string ToUtf8(const std::u8string& Text)
{
    return std::string(reinterpret_cast<const char*>(Text.data()), Text.size());
}

class NumberScanner
{
  public:
    explicit NumberScanner(const std::string& Text) noexcept : Cursor(Text.c_str()), End(Text.c_str() + Text.size()) {}

    bool Next(double& Value) noexcept
    {
        while (Cursor < End)
        {
            char* ParsedEnd = nullptr;
            Value = std::strtod(Cursor, &ParsedEnd);
            if (ParsedEnd != Cursor)
            {
                Cursor = ParsedEnd;
                return true;
            }
            ++Cursor;
        }
        return false;
    }

  private:
    const char* Cursor;
    const char* End;
};

bool ReadInteger(double Value, uint32_t Minimum, uint32_t Maximum, uint32_t& Result) noexcept
{
    if (!std::isfinite(Value) || Value < Minimum || Value > Maximum) return false;
    const double Rounded = std::round(Value);
    if (std::fabs(Value - Rounded) > 1.0e-9) return false;
    Result = static_cast<uint32_t>(Rounded);
    return true;
}

struct AngleBracket
{
    size_t Lower = 0;
    size_t Upper = 0;
    double T = 0.0;
};

AngleBracket FindAngleBracket(const std::vector<float>& Angles, double Value) noexcept
{
    if (Angles.size() <= 1) return {};
    const double Clamped = std::clamp(Value, static_cast<double>(Angles.front()), static_cast<double>(Angles.back()));
    const auto Upper = std::upper_bound(Angles.begin(), Angles.end(), static_cast<float>(Clamped));
    if (Upper == Angles.begin()) return { 0, 0, 0.0 };
    if (Upper == Angles.end()) return { Angles.size() - 1, Angles.size() - 1, 0.0 };
    const size_t Hi = static_cast<size_t>(Upper - Angles.begin());
    const size_t Lo = Hi - 1;
    const double Span = static_cast<double>(Angles[Hi]) - Angles[Lo];
    return { Lo, Hi, Span > 0.0 ? (Clamped - Angles[Lo]) / Span : 0.0 };
}

double ReflectAzimuth(double AzimuthDeg, double HorizontalEnd) noexcept
{
    double Angle = std::fmod(AzimuthDeg, FullTurnDeg);
    if (Angle < 0.0) Angle += FullTurnDeg;
    if (std::fabs(HorizontalEnd) <= AngleTolerance) return 0.0;
    if (std::fabs(HorizontalEnd - 90.0) <= AngleTolerance)
    {
        const double Half = std::fmod(Angle, HalfTurnDeg);
        return std::min(Half, HalfTurnDeg - Half);
    }
    if (std::fabs(HorizontalEnd - 180.0) <= AngleTolerance) return std::min(Angle, FullTurnDeg - Angle);
    return Angle; // Full 0°..360° C-plane data.
}

float SampleRaw(const PhotometricIesProfile& Profile, double AzimuthDeg, double PolarDeg) noexcept
{
    const size_t VerticalCount = Profile.VerticalAnglesDeg.size();
    const size_t HorizontalCount = Profile.HorizontalAnglesDeg.size();
    if (VerticalCount < 2 || HorizontalCount == 0 || Profile.Candela.size() != VerticalCount * HorizontalCount ||
        !(Profile.PeakCandela > 0.0)) return 0.0f;

    const AngleBracket H = FindAngleBracket(Profile.HorizontalAnglesDeg,
                                             ReflectAzimuth(AzimuthDeg, Profile.HorizontalAnglesDeg.back()));
    const AngleBracket V = FindAngleBracket(Profile.VerticalAnglesDeg, PolarDeg);
    const auto At = [&](size_t Plane, size_t Angle) -> double
    {
        return Profile.Candela[Plane * VerticalCount + Angle];
    };
    const double Lower = At(H.Lower, V.Lower) + (At(H.Lower, V.Upper) - At(H.Lower, V.Lower)) * V.T;
    const double Upper = At(H.Upper, V.Lower) + (At(H.Upper, V.Upper) - At(H.Upper, V.Lower)) * V.T;
    return static_cast<float>(std::clamp((Lower + (Upper - Lower) * H.T) / Profile.PeakCandela, 0.0, 1.0));
}

bool FindTiltNone(std::string_view Text, size_t& DataOffset, std::string& Error)
{
    size_t Start = 0;
    while (Start <= Text.size())
    {
        const size_t Newline = Text.find('\n', Start);
        const size_t End = Newline == std::string_view::npos ? Text.size() : Newline;
        const std::string_view Line = Trim(Text.substr(Start, End - Start));
        const size_t Equal = Line.find('=');
        if (Equal != std::string_view::npos && EqualsAsciiInsensitive(Trim(Line.substr(0, Equal)), "TILT"))
        {
            if (!EqualsAsciiInsensitive(Trim(Line.substr(Equal + 1)), "NONE"))
            {
                Error = "Only LM-63 TILT=NONE files are supported; external tilt tables are not loaded.";
                return false;
            }
            DataOffset = Newline == std::string_view::npos ? Text.size() : Newline + 1;
            return true;
        }
        if (Newline == std::string_view::npos) break;
        Start = Newline + 1;
    }
    Error = "The file has no LM-63 TILT= line.";
    return false;
}

bool ValidateAngles(const std::vector<float>& Angles, double Maximum, bool RequireTwo, const char* Name,
                    std::string& Error)
{
    if (Angles.empty() || (RequireTwo && Angles.size() < 2))
    {
        Error = std::string("The IES ") + Name + " angle list is incomplete.";
        return false;
    }
    if (std::fabs(Angles.front()) > AngleTolerance)
    {
        Error = std::string("The IES ") + Name + " angles must start at 0 degrees.";
        return false;
    }
    for (size_t Index = 0; Index < Angles.size(); ++Index)
    {
        if (!std::isfinite(Angles[Index]) || Angles[Index] < 0.0f || Angles[Index] > Maximum ||
            (Index > 0 && !(Angles[Index] > Angles[Index - 1])))
        {
            Error = std::string("The IES ") + Name + " angles must increase strictly within the Type-C range.";
            return false;
        }
    }
    return true;
}

} // namespace

bool ParsePhotometricIes(std::string_view Text, const std::string& Name, PhotometricIesProfile& Profile,
                         std::string& Error)
{
    Error.clear();
    if (Text.empty())
    {
        Error = "The IES file is empty.";
        return false;
    }
    if (Text.size() > PhotometricIesMaximumFileBytes)
    {
        Error = "The IES file exceeds the 4 MiB safety limit.";
        return false;
    }
    size_t DataOffset = 0;
    if (!FindTiltNone(Text, DataOffset, Error)) return false;

    const std::string NumericText(Text.substr(DataOffset)); // Ensure the strtod input has a trailing NUL.
    NumberScanner Numbers(NumericText);
    double Header[13]{};
    for (double& Value : Header)
    {
        if (!Numbers.Next(Value) || !std::isfinite(Value))
        {
            Error = "The LM-63 photometric header is incomplete or non-finite.";
            return false;
        }
    }

    PhotometricIesProfile Parsed;
    Parsed.Name = Name.empty() ? "Imported IES" : Name;
    uint32_t VerticalCount = 0, HorizontalCount = 0, PhotometricType = 0, UnitsType = 0;
    if (!ReadInteger(Header[0], 1, 100000, Parsed.NumberOfLamps) || !std::isfinite(Header[1]) ||
        !std::isfinite(Header[2]) || Header[2] <= 0.0 || !ReadInteger(Header[3], 2, 181, VerticalCount) ||
        !ReadInteger(Header[4], 1, 361, HorizontalCount) || !ReadInteger(Header[5], 1, 3, PhotometricType) ||
        !ReadInteger(Header[6], 1, 2, UnitsType) || !std::isfinite(Header[12]))
    {
        Error = "The LM-63 header has invalid counts, multiplier, units, or photometric type.";
        return false;
    }
    if (PhotometricType != 1)
    {
        Error = "Only LM-63 Type-C photometry (photometric type 1) is supported.";
        return false;
    }

    Parsed.LumensPerLamp = Header[1];
    Parsed.CandelaMultiplier = Header[2];
    Parsed.PhotometricType = PhotometricType;
    Parsed.UnitsType = UnitsType;
    Parsed.InputWatts = Header[12];
    Parsed.VerticalAnglesDeg.reserve(VerticalCount);
    Parsed.HorizontalAnglesDeg.reserve(HorizontalCount);
    Parsed.Candela.reserve(static_cast<size_t>(VerticalCount) * HorizontalCount);

    double Value = 0.0;
    for (uint32_t Index = 0; Index < VerticalCount; ++Index)
    {
        if (!Numbers.Next(Value) || !std::isfinite(Value) || std::fabs(Value) > std::numeric_limits<float>::max())
        {
            Error = "The LM-63 vertical-angle list is truncated or non-finite.";
            return false;
        }
        Parsed.VerticalAnglesDeg.push_back(static_cast<float>(Value));
    }
    for (uint32_t Index = 0; Index < HorizontalCount; ++Index)
    {
        if (!Numbers.Next(Value) || !std::isfinite(Value) || std::fabs(Value) > std::numeric_limits<float>::max())
        {
            Error = "The LM-63 horizontal-angle list is truncated or non-finite.";
            return false;
        }
        Parsed.HorizontalAnglesDeg.push_back(static_cast<float>(Value));
    }
    if (!ValidateAngles(Parsed.VerticalAnglesDeg, 180.0, true, "vertical", Error) ||
        !ValidateAngles(Parsed.HorizontalAnglesDeg, 360.0, false, "horizontal", Error)) return false;

    const double HorizontalEnd = Parsed.HorizontalAnglesDeg.back();
    if (std::fabs(HorizontalEnd) > AngleTolerance && std::fabs(HorizontalEnd - 90.0) > AngleTolerance &&
        std::fabs(HorizontalEnd - 180.0) > AngleTolerance && std::fabs(HorizontalEnd - 360.0) > AngleTolerance)
    {
        Error = "The LM-63 C-plane coverage must end at 0, 90, 180, or 360 degrees.";
        return false;
    }

    double Peak = 0.0;
    const size_t CandelaCount = static_cast<size_t>(VerticalCount) * HorizontalCount;
    for (size_t Index = 0; Index < CandelaCount; ++Index)
    {
        if (!Numbers.Next(Value) || !std::isfinite(Value) || Value < 0.0)
        {
            Error = "The LM-63 candela grid is truncated, negative, or non-finite.";
            return false;
        }
        const double Candela = Value * Parsed.CandelaMultiplier;
        if (!std::isfinite(Candela) || Candela > std::numeric_limits<float>::max())
        {
            Error = "The LM-63 candela multiplier overflows supported profile storage.";
            return false;
        }
        Parsed.Candela.push_back(static_cast<float>(Candela));
        Peak = std::max(Peak, Candela);
    }
    if (!(Peak > 0.0))
    {
        Error = "The LM-63 candela grid contains no positive intensity.";
        return false;
    }
    Parsed.PeakCandela = Peak;
    for (uint32_t Azimuth = 0; Azimuth < PhotometricIesAzimuthSamples; ++Azimuth)
    {
        const double AzimuthDeg = FullTurnDeg * Azimuth / PhotometricIesAzimuthSamples;
        for (uint32_t Polar = 0; Polar < PhotometricIesPolarSamples; ++Polar)
        {
            const double PolarDeg = HalfTurnDeg * Polar / (PhotometricIesPolarSamples - 1);
            Parsed.NormalizedDistribution[static_cast<size_t>(Azimuth) * PhotometricIesPolarSamples + Polar] =
                SampleRaw(Parsed, AzimuthDeg, PolarDeg);
        }
    }
    Profile = std::move(Parsed);
    return true;
}

bool LoadPhotometricIesFile(const std::filesystem::path& Path, PhotometricIesProfile& Profile, std::string& Error)
{
    Error.clear();
    std::error_code SizeError;
    const uintmax_t Size = std::filesystem::file_size(Path, SizeError);
    if (SizeError)
    {
        Error = "The selected IES file could not be opened.";
        return false;
    }
    if (Size == 0 || Size > PhotometricIesMaximumFileBytes)
    {
        Error = Size == 0 ? "The IES file is empty." : "The IES file exceeds the 4 MiB safety limit.";
        return false;
    }
    std::ifstream Input(Path, std::ios::binary);
    if (!Input)
    {
        Error = "The selected IES file could not be read.";
        return false;
    }
    std::string Text(static_cast<size_t>(Size), '\0');
    Input.read(Text.data(), static_cast<std::streamsize>(Text.size()));
    if (Input.gcount() != static_cast<std::streamsize>(Text.size()))
    {
        Error = "The selected IES file could not be read completely.";
        return false;
    }
    PhotometricIesProfile Parsed;
    if (!ParsePhotometricIes(Text, ToUtf8(Path.stem().u8string()), Parsed, Error)) return false;
    Parsed.SourcePath = ToUtf8(Path.lexically_normal().u8string());
    Profile = std::move(Parsed);
    return true;
}

float SamplePhotometricIes(const PhotometricIesProfile& Profile, double AzimuthDeg, double PolarDeg) noexcept
{
    if (!std::isfinite(AzimuthDeg) || !std::isfinite(PolarDeg)) return 0.0f;
    const double Turn = std::fmod(AzimuthDeg, FullTurnDeg);
    const double Azimuth = Turn < 0.0 ? Turn + FullTurnDeg : Turn;
    const double HPosition = Azimuth * PhotometricIesAzimuthSamples / FullTurnDeg;
    const double VPosition = std::clamp(PolarDeg, 0.0, HalfTurnDeg) * (PhotometricIesPolarSamples - 1) / HalfTurnDeg;
    const uint32_t H0 = static_cast<uint32_t>(std::floor(HPosition)) % PhotometricIesAzimuthSamples;
    const uint32_t H1 = (H0 + 1) % PhotometricIesAzimuthSamples;
    const uint32_t V0 = static_cast<uint32_t>(std::floor(VPosition));
    const uint32_t V1 = std::min(V0 + 1, PhotometricIesPolarSamples - 1);
    const double HT = HPosition - std::floor(HPosition);
    const double VT = VPosition - V0;
    const auto At = [&](uint32_t H, uint32_t V)
    {
        return Profile.NormalizedDistribution[static_cast<size_t>(H) * PhotometricIesPolarSamples + V];
    };
    const double A = At(H0, V0) + (At(H0, V1) - At(H0, V0)) * VT;
    const double B = At(H1, V0) + (At(H1, V1) - At(H1, V0)) * VT;
    return static_cast<float>(std::clamp(A + (B - A) * HT, 0.0, 1.0));
}

} // namespace Frontier
