/*==========================================================================================================================================
                                                             SPACECODEC.H
==========================================================================================================================================*/
// 🧩 Generic C++20 TOML-backed `*space` codec ("one template function for many domain schemas").
//    Enforces `*space` file extensions (refusing `.toml` authoring) and drives serialization from declarative schemas.

#pragma once

#include "Frontier/Engine/Foundation/Math.h"

#include <toml++/toml.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <concepts>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                 SCHEMA DECLARATION PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

template <typename ScalarT>
struct FieldBounds
{
    ScalarT Minimum{};
    ScalarT Maximum{};
    bool    Active = false;
};

template <typename OwnerT, typename MemberT>
struct FieldBinding
{
    using CleanMemberT = std::remove_cv_t<MemberT>;

    std::string_view              Key;
    MemberT OwnerT::*             Member;
    FieldBounds<double>           Clamp{};
};

template <typename OwnerT, typename MemberT>
[[nodiscard]] constexpr FieldBinding<OwnerT, MemberT> MakeFieldBinding(std::string_view  Key,
                                                                       MemberT OwnerT::* Member) noexcept
{
    return { Key, Member, { 0.0, 0.0, false } };
}

template <typename OwnerT, typename MemberT>
[[nodiscard]] constexpr FieldBinding<OwnerT, MemberT> MakeClampedField(std::string_view  Key,
                                                                       MemberT OwnerT::* Member,
                                                                       double            Minimum,
                                                                       double            Maximum) noexcept
{
    return { Key, Member, { Minimum, Maximum, true } };
}

template <typename T>
struct SpaceSchema;

template <typename T>
concept HasSpaceSchema = requires {
    SpaceSchema<std::remove_cvref_t<T>>::Bindings();
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  EXTENSION VALIDATION
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] inline bool IsForbiddenTomlExtension(const std::filesystem::path& FilePath)
{
    std::string Ext = FilePath.extension().string();
    std::transform(Ext.begin(), Ext.end(), Ext.begin(), [](unsigned char Ch) {
        return static_cast<char>(std::tolower(Ch));
    });
    return Ext == ".toml";
}

[[nodiscard]] inline bool ValidateSpaceExtension(const std::filesystem::path& FilePath,
                                                 std::string_view             ExpectedExtension,
                                                 std::string*                 OutDiagnostic = nullptr)
{
    if (IsForbiddenTomlExtension(FilePath))
    {
        if (OutDiagnostic != nullptr)
        {
            *OutDiagnostic = "Refused .toml extension; Frontier domain containers must use *space: " +
                             FilePath.string();
        }
        return false;
    }
    const std::string Actual = FilePath.extension().string();
    if (Actual != ExpectedExtension)
    {
        if (OutDiagnostic != nullptr)
        {
            *OutDiagnostic = "Expected " + std::string(ExpectedExtension) + " extension, got '" + Actual + "'";
        }
        return false;
    }
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  GENERIC VALUE CODECS
//------------------------------------------------------------------------------------------------------------------------

namespace Detail
{

template <typename T>
[[nodiscard]] inline T ApplyBounds(T Value, const FieldBounds<double>& Clamp) noexcept
{
    if (!Clamp.Active)
    {
        return Value;
    }
    if constexpr (std::is_floating_point_v<T>)
    {
        return static_cast<T>(std::clamp(static_cast<double>(Value), Clamp.Minimum, Clamp.Maximum));
    }
    else if constexpr (std::is_integral_v<T> && !std::is_same_v<T, bool>)
    {
        const int64_t Low  = static_cast<int64_t>(Clamp.Minimum);
        const int64_t High = static_cast<int64_t>(Clamp.Maximum);
        return static_cast<T>(std::clamp<int64_t>(static_cast<int64_t>(Value), Low, High));
    }
    else
    {
        return Value;
    }
}

template <typename T>
void EncodeValue(toml::table& OutTable, std::string_view Key, const T& Value);

template <typename T>
void DecodeValue(const toml::table& InTable, std::string_view Key, T& OutValue, const FieldBounds<double>& Clamp);

template <typename T>
[[nodiscard]] toml::array EncodeSequence(const T* Elements, size_t Count)
{
    toml::array Array;
    for (size_t Index = 0; Index < Count; ++Index)
    {
        if constexpr (std::is_same_v<T, bool> || std::is_same_v<T, std::string>)
        {
            Array.push_back(Elements[Index]);
        }
        else if constexpr (std::is_floating_point_v<T>)
        {
            Array.push_back(static_cast<double>(Elements[Index]));
        }
        else if constexpr (std::is_integral_v<T>)
        {
            Array.push_back(static_cast<int64_t>(Elements[Index]));
        }
        else if constexpr (HasSpaceSchema<T>)
        {
            toml::table Sub;
            EncodeSpaceTable(Sub, Elements[Index]);
            Array.push_back(std::move(Sub));
        }
    }
    return Array;
}

template <typename T>
void DecodeScalarNode(const toml::node& Node, T& OutValue, const FieldBounds<double>& Clamp)
{
    if constexpr (std::is_same_v<T, bool>)
    {
        if (const auto V = Node.value<bool>())
        {
            OutValue = *V;
        }
    }
    else if constexpr (std::is_enum_v<T>)
    {
        using RawT = std::underlying_type_t<T>;
        if (const auto V = Node.value<int64_t>())
        {
            RawT Raw = static_cast<RawT>(*V);
            Raw      = ApplyBounds(Raw, Clamp);
            OutValue = static_cast<T>(Raw);
        }
    }
    else if constexpr (std::is_floating_point_v<T>)
    {
        double Parsed = 0.0;
        bool   Valid  = false;
        if (const auto V = Node.value<double>(); V && std::isfinite(*V))
        {
            Parsed = *V;
            Valid  = true;
        }
        else if (const auto I = Node.value<int64_t>())
        {
            Parsed = static_cast<double>(*I);
            Valid  = true;
        }
        if (Valid && std::abs(Parsed) <= static_cast<double>(std::numeric_limits<T>::max()))
        {
            OutValue = ApplyBounds(static_cast<T>(Parsed), Clamp);
        }
    }
    else if constexpr (std::is_integral_v<T>)
    {
        if (const auto I = Node.value<int64_t>())
        {
            if constexpr (std::is_unsigned_v<T>)
            {
                const int64_t MaxVal = static_cast<int64_t>(
                    std::min<uint64_t>(std::numeric_limits<T>::max(),
                                       static_cast<uint64_t>(std::numeric_limits<int64_t>::max())));
                T Clamped = static_cast<T>(std::clamp<int64_t>(*I, 0, MaxVal));
                OutValue  = ApplyBounds(Clamped, Clamp);
            }
            else
            {
                const int64_t MinVal = static_cast<int64_t>(std::numeric_limits<T>::min());
                const int64_t MaxVal = static_cast<int64_t>(std::numeric_limits<T>::max());
                T Clamped            = static_cast<T>(std::clamp<int64_t>(*I, MinVal, MaxVal));
                OutValue             = ApplyBounds(Clamped, Clamp);
            }
        }
    }
    else if constexpr (std::is_same_v<T, std::string>)
    {
        if (const auto S = Node.value<std::string>())
        {
            OutValue = *S;
        }
    }
}

} // namespace Detail

//------------------------------------------------------------------------------------------------------------------------
//                                                 TABLE ENCODE / DECODE
//------------------------------------------------------------------------------------------------------------------------

template <HasSpaceSchema SchemaT>
void EncodeSpaceTable(toml::table& OutTable, const SchemaT& Instance);

template <HasSpaceSchema SchemaT>
void DecodeSpaceTable(const toml::table& InTable, SchemaT& OutInstance);

namespace Detail
{

template <typename T>
struct IsStdArray : std::false_type
{
};

template <typename ElemT, size_t Count>
struct IsStdArray<std::array<ElemT, Count>> : std::true_type
{
    using ElementType                  = ElemT;
    static constexpr size_t ArrayCount = Count;
};

template <typename T>
struct IsStdVector : std::false_type
{
};

template <typename ElemT, typename AllocT>
struct IsStdVector<std::vector<ElemT, AllocT>> : std::true_type
{
    using ElementType = ElemT;
};

template <typename T>
struct IsStdOptional : std::false_type
{
};

template <typename InnerT>
struct IsStdOptional<std::optional<InnerT>> : std::true_type
{
    using InnerType = InnerT;
};

template <typename T>
void EncodeValue(toml::table& OutTable, std::string_view Key, const T& Value)
{
    if constexpr (std::is_same_v<T, bool> || std::is_same_v<T, std::string>)
    {
        OutTable.insert_or_assign(Key, Value);
    }
    else if constexpr (std::is_enum_v<T>)
    {
        OutTable.insert_or_assign(Key, static_cast<int64_t>(Value));
    }
    else if constexpr (std::is_floating_point_v<T>)
    {
        OutTable.insert_or_assign(Key, static_cast<double>(Value));
    }
    else if constexpr (std::is_integral_v<T>)
    {
        OutTable.insert_or_assign(Key, static_cast<int64_t>(Value));
    }
    else if constexpr (std::is_same_v<T, Vector2<float>> || std::is_same_v<T, Vector2<double>>)
    {
        const auto Arr = Value.ToArray();
        OutTable.insert_or_assign(Key, EncodeSequence(Arr.data(), Arr.size()));
    }
    else if constexpr (std::is_same_v<T, Vector3<float>> || std::is_same_v<T, Vector3<double>>)
    {
        const auto Arr = Value.ToArray();
        OutTable.insert_or_assign(Key, EncodeSequence(Arr.data(), Arr.size()));
    }
    else if constexpr (std::is_same_v<T, Vector4<float>> || std::is_same_v<T, Vector4<double>> ||
                       std::is_same_v<T, Quaternion<float>> || std::is_same_v<T, Quaternion<double>>)
    {
        const auto Arr = Value.ToArray();
        OutTable.insert_or_assign(Key, EncodeSequence(Arr.data(), Arr.size()));
    }
    else if constexpr (std::is_bounded_array_v<T>)
    {
        constexpr size_t Count = std::extent_v<T>;
        OutTable.insert_or_assign(Key, EncodeSequence(&Value[0], Count));
    }
    else if constexpr (IsStdArray<T>::value)
    {
        if constexpr (HasSpaceSchema<typename IsStdArray<T>::ElementType>)
        {
            toml::array Array;
            for (const auto& Elem : Value)
            {
                toml::table Sub;
                EncodeSpaceTable(Sub, Elem);
                Array.push_back(std::move(Sub));
            }
            OutTable.insert_or_assign(Key, std::move(Array));
        }
        else
        {
            OutTable.insert_or_assign(Key, EncodeSequence(Value.data(), Value.size()));
        }
    }
    else if constexpr (IsStdVector<T>::value)
    {
        toml::array Array;
        for (const auto& Elem : Value)
        {
            using ElemT = typename IsStdVector<T>::ElementType;
            if constexpr (HasSpaceSchema<ElemT>)
            {
                toml::table Sub;
                EncodeSpaceTable(Sub, Elem);
                Array.push_back(std::move(Sub));
            }
            else if constexpr (std::is_same_v<ElemT, bool> || std::is_same_v<ElemT, std::string>)
            {
                Array.push_back(Elem);
            }
            else if constexpr (std::is_floating_point_v<ElemT>)
            {
                Array.push_back(static_cast<double>(Elem));
            }
            else if constexpr (std::is_integral_v<ElemT>)
            {
                Array.push_back(static_cast<int64_t>(Elem));
            }
        }
        OutTable.insert_or_assign(Key, std::move(Array));
    }
    else if constexpr (IsStdOptional<T>::value)
    {
        if (Value.has_value())
        {
            EncodeValue(OutTable, Key, *Value);
        }
    }
    else if constexpr (HasSpaceSchema<T>)
    {
        toml::table Sub;
        EncodeSpaceTable(Sub, Value);
        OutTable.insert_or_assign(Key, std::move(Sub));
    }
}

template <typename T>
void DecodeValue(const toml::table& InTable, std::string_view Key, T& OutValue, const FieldBounds<double>& Clamp)
{
    const auto* Node = InTable.get(Key);
    if (Node == nullptr)
    {
        return;
    }

    if constexpr (std::is_same_v<T, bool> || std::is_enum_v<T> || std::is_arithmetic_v<T> ||
                  std::is_same_v<T, std::string>)
    {
        DecodeScalarNode(*Node, OutValue, Clamp);
    }
    else if constexpr (std::is_same_v<T, Vector2<float>> || std::is_same_v<T, Vector2<double>> ||
                       std::is_same_v<T, Vector3<float>> || std::is_same_v<T, Vector3<double>> ||
                       std::is_same_v<T, Vector4<float>> || std::is_same_v<T, Vector4<double>> ||
                       std::is_same_v<T, Quaternion<float>> || std::is_same_v<T, Quaternion<double>>)
    {
        if (const toml::array* Array = Node->as_array())
        {
            auto Arr = OutValue.ToArray();
            for (size_t Index = 0; Index < Arr.size() && Index < Array->size(); ++Index)
            {
                DecodeScalarNode((*Array)[Index], Arr[Index], Clamp);
            }
            OutValue = T::FromArray(Arr);
        }
    }
    else if constexpr (std::is_bounded_array_v<T>)
    {
        constexpr size_t Count = std::extent_v<T>;
        if (const toml::array* Array = Node->as_array())
        {
            for (size_t Index = 0; Index < Count && Index < Array->size(); ++Index)
            {
                DecodeScalarNode((*Array)[Index], OutValue[Index], Clamp);
            }
        }
    }
    else if constexpr (IsStdArray<T>::value)
    {
        using ElemT = typename IsStdArray<T>::ElementType;
        if (const toml::array* Array = Node->as_array())
        {
            for (size_t Index = 0; Index < OutValue.size() && Index < Array->size(); ++Index)
            {
                if constexpr (HasSpaceSchema<ElemT>)
                {
                    if (const toml::table* Sub = (*Array)[Index].as_table())
                    {
                        DecodeSpaceTable(*Sub, OutValue[Index]);
                    }
                }
                else
                {
                    DecodeScalarNode((*Array)[Index], OutValue[Index], Clamp);
                }
            }
        }
    }
    else if constexpr (IsStdVector<T>::value)
    {
        using ElemT = typename IsStdVector<T>::ElementType;
        if (const toml::array* Array = Node->as_array())
        {
            OutValue.clear();
            OutValue.reserve(Array->size());
            for (size_t Index = 0; Index < Array->size(); ++Index)
            {
                const toml::node& ElemNode = (*Array)[Index];
                if constexpr (HasSpaceSchema<ElemT>)
                {
                    if (const toml::table* Sub = ElemNode.as_table())
                    {
                        ElemT Item{};
                        DecodeSpaceTable(*Sub, Item);
                        OutValue.push_back(std::move(Item));
                    }
                }
                else
                {
                    ElemT Item{};
                    DecodeScalarNode(ElemNode, Item, Clamp);
                    OutValue.push_back(std::move(Item));
                }
            }
        }
    }
    else if constexpr (IsStdOptional<T>::value)
    {
        using InnerT = typename IsStdOptional<T>::InnerType;
        InnerT Inner{};
        DecodeValue(InTable, Key, Inner, Clamp);
        OutValue = std::move(Inner);
    }
    else if constexpr (HasSpaceSchema<T>)
    {
        if (const toml::table* Sub = Node->as_table())
        {
            DecodeSpaceTable(*Sub, OutValue);
        }
    }
}

} // namespace Detail

template <HasSpaceSchema SchemaT>
void EncodeSpaceTable(toml::table& OutTable, const SchemaT& Instance)
{
    const auto Bindings = SpaceSchema<SchemaT>::Bindings();
    std::apply(
        [&](const auto&... Field) {
            (Detail::EncodeValue(OutTable, Field.Key, Instance.*(Field.Member)), ...);
        },
        Bindings);
}

template <HasSpaceSchema SchemaT>
void DecodeSpaceTable(const toml::table& InTable, SchemaT& OutInstance)
{
    const auto Bindings = SpaceSchema<SchemaT>::Bindings();
    std::apply(
        [&](const auto&... Field) {
            (Detail::DecodeValue(InTable, Field.Key, OutInstance.*(Field.Member), Field.Clamp), ...);
        },
        Bindings);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 FILE ENCODE / DECODE
//------------------------------------------------------------------------------------------------------------------------

template <HasSpaceSchema SpaceT>
[[nodiscard]] bool EncodeSpaceText(std::string_view FormatTag,
                                   int64_t          Version,
                                   const SpaceT&    Value,
                                   std::string&     OutText)
{
    toml::table Root;
    Root.insert_or_assign("format", std::string(FormatTag));
    Root.insert_or_assign("version", Version);
    EncodeSpaceTable(Root, Value);
    std::ostringstream Stream;
    Stream << Root << "\n";
    OutText = Stream.str();
    return true;
}

template <HasSpaceSchema SpaceT>
[[nodiscard]] bool DecodeSpaceText(std::string_view Text,
                                   std::string_view ExpectedFormat,
                                   int64_t          MaxSupportedVersion,
                                   SpaceT&          OutValue,
                                   std::string*     OutDiagnostic = nullptr)
{
    toml::table Document;
    try
    {
        Document = toml::parse(Text);
    }
    catch (const toml::parse_error& Error)
    {
        if (OutDiagnostic != nullptr)
        {
            *OutDiagnostic = std::string(Error.description());
        }
        return false;
    }

    if (!ExpectedFormat.empty())
    {
        const std::string Format = Document["format"].value_or(std::string{});
        if (Format != ExpectedFormat)
        {
            if (OutDiagnostic != nullptr)
            {
                *OutDiagnostic = "Space format mismatch: expected '" + std::string(ExpectedFormat) + "', got '" +
                                 Format + "'";
            }
            return false;
        }
    }

    const int64_t Version = Document["version"].value_or(int64_t{ 1 });
    if (Version > MaxSupportedVersion)
    {
        if (OutDiagnostic != nullptr)
        {
            *OutDiagnostic = "Unsupported space version " + std::to_string(Version);
        }
        return false;
    }

    SpaceT Decoded{};
    DecodeSpaceTable(Document, Decoded);
    OutValue = std::move(Decoded);
    return true;
}

template <HasSpaceSchema SpaceT>
[[nodiscard]] bool EncodeSpaceFile(const std::filesystem::path& FilePath,
                                   std::string_view             ExpectedExtension,
                                   std::string_view             FormatTag,
                                   int64_t                      Version,
                                   const SpaceT&                Value,
                                   std::string*                 OutDiagnostic = nullptr)
{
    if (!ValidateSpaceExtension(FilePath, ExpectedExtension, OutDiagnostic))
    {
        return false;
    }

    std::error_code FsError;
    if (FilePath.has_parent_path())
    {
        std::filesystem::create_directories(FilePath.parent_path(), FsError);
    }

    std::string Text;
    (void)EncodeSpaceText(FormatTag, Version, Value, Text);

    std::ofstream Output(FilePath, std::ios::binary | std::ios::trunc);
    if (!Output)
    {
        if (OutDiagnostic != nullptr)
        {
            *OutDiagnostic = "Unable to open space file for writing: " + FilePath.string();
        }
        return false;
    }
    Output << Text;
    return Output.good();
}

template <HasSpaceSchema SpaceT>
[[nodiscard]] bool DecodeSpaceFile(const std::filesystem::path& FilePath,
                                   std::string_view             ExpectedExtension,
                                   std::string_view             ExpectedFormat,
                                   int64_t                      MaxSupportedVersion,
                                   SpaceT&                      OutValue,
                                   std::string*                 OutDiagnostic = nullptr)
{
    if (!ValidateSpaceExtension(FilePath, ExpectedExtension, OutDiagnostic))
    {
        return false;
    }

    std::ifstream Input(FilePath, std::ios::binary);
    if (!Input)
    {
        if (OutDiagnostic != nullptr)
        {
            *OutDiagnostic = "Unable to open space file: " + FilePath.string();
        }
        return false;
    }

    std::ostringstream Stream;
    Stream << Input.rdbuf();
    return DecodeSpaceText(Stream.str(), ExpectedFormat, MaxSupportedVersion, OutValue, OutDiagnostic);
}

} // namespace Frontier
