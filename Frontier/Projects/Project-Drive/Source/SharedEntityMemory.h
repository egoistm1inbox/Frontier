/*====================================================================================================================================
                                                      SHAREDENTITYMEMORY.H
====================================================================================================================================*/
// 🧩 True OS zero-copy shared-memory segment (POSIX shm_open + mmap(MAP_SHARED) / Win32 CreateFileMappingA +
//    MapViewOfFile) hosting live Project-Drive entity records so Dedicated Entity Editor popup windows and the
//    main 3D scene viewport read and mutate the exact same physical RAM pages (0 bytes duplicated).

#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <new>
#include <string>
#include <utility>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace Frontier::Drive
{

template <typename T>
class SharedEntityMemorySegment
{
  public:
    SharedEntityMemorySegment() = default;

    ~SharedEntityMemorySegment()
    {
        Destroy();
    }

    SharedEntityMemorySegment(const SharedEntityMemorySegment &)            = delete;
    SharedEntityMemorySegment &operator=(const SharedEntityMemorySegment &) = delete;

    template <typename... Args>
    T *ConstructInSharedMemory(const char *SegmentTag, Args &&...ConstructorArgs)
    {
        Destroy();
        MappedBytes_ = ((sizeof(T) + 4095u) / 4096u) * 4096u;

#if defined(_WIN32)
        constexpr unsigned long kPageReadWrite    = 0x04UL;
        constexpr unsigned long kFileMapAllAccess = 0x000F001FUL;
        void *const             kInvalidHandle    = reinterpret_cast<void *>(static_cast< intptr_t >(-1));

        char MapName[128] = {};
        std::snprintf(MapName, sizeof(MapName), "Local\\FrontierSharedEntities_%s_%lu",
                      SegmentTag != nullptr ? SegmentTag : "Drive",
                      ::GetCurrentProcessId());
        MappingHandle_ = ::CreateFileMappingA(
            kInvalidHandle, nullptr, kPageReadWrite,
            static_cast<unsigned long>((static_cast<uint64_t>(MappedBytes_) >> 32u) & 0xFFFFFFFFu),
            static_cast<unsigned long>(MappedBytes_ & 0xFFFFFFFFu),
            MapName);
        if (MappingHandle_ != nullptr)
        {
            RawView_ = ::MapViewOfFile(MappingHandle_, kFileMapAllAccess, 0UL, 0UL, MappedBytes_);
            if (RawView_ != nullptr)
            {
                UsingOsSharedMapping_ = true;
                SegmentName_          = MapName;
            }
        }
#else
        char ShmPath[128] = {};
        std::snprintf(ShmPath, sizeof(ShmPath), "/frontier_shm_%s_%d",
                      SegmentTag != nullptr ? SegmentTag : "drive",
                      static_cast<int>(::getpid()));
        int Fd = ::shm_open(ShmPath, O_CREAT | O_RDWR | O_EXCL, 0600);
        if (Fd >= 0)
        {
            ::shm_unlink(ShmPath);
            if (::ftruncate(Fd, static_cast<off_t>(MappedBytes_)) == 0)
            {
                void *Mapped = ::mmap(nullptr, MappedBytes_, PROT_READ | PROT_WRITE, MAP_SHARED, Fd, 0);
                if (Mapped != MAP_FAILED)
                {
                    RawView_              = Mapped;
                    UsingOsSharedMapping_ = true;
                    SegmentName_          = ShmPath;
                }
            }
            ::close(Fd);
        }
        if (RawView_ == nullptr)
        {
            void *AnonShared = ::mmap(nullptr, MappedBytes_, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
            if (AnonShared != MAP_FAILED)
            {
                RawView_              = AnonShared;
                UsingOsSharedMapping_ = true;
                SegmentName_          = "mmap(MAP_SHARED|MAP_ANONYMOUS)";
            }
        }
#endif

        if (RawView_ == nullptr)
        {
            RawView_              = ::operator new(MappedBytes_);
            UsingOsSharedMapping_ = false;
            SegmentName_          = "in-process-shared-address";
        }

        ObjectPtr_ = new (RawView_) T(std::forward<Args>(ConstructorArgs)...);
        return ObjectPtr_;
    }

    void Destroy() noexcept
    {
        if (ObjectPtr_ != nullptr)
        {
            ObjectPtr_->~T();
            ObjectPtr_ = nullptr;
        }
        if (RawView_ != nullptr)
        {
#if defined(_WIN32)
            if (UsingOsSharedMapping_)
            {
                ::UnmapViewOfFile(RawView_);
                if (MappingHandle_ != nullptr)
                {
                    ::CloseHandle(MappingHandle_);
                    MappingHandle_ = nullptr;
                }
            }
            else
            {
                ::operator delete(RawView_);
            }
#else
            if (UsingOsSharedMapping_)
            {
                ::munmap(RawView_, MappedBytes_);
            }
            else
            {
                ::operator delete(RawView_);
            }
#endif
            RawView_ = nullptr;
        }
        MappedBytes_          = 0u;
        UsingOsSharedMapping_ = false;
    }

    [[nodiscard]] T       *Get() noexcept { return ObjectPtr_; }
    [[nodiscard]] const T *Get() const noexcept { return ObjectPtr_; }
    [[nodiscard]] T       &operator*() noexcept { return *ObjectPtr_; }
    [[nodiscard]] const T &operator*() const noexcept { return *ObjectPtr_; }
    [[nodiscard]] T       *operator->() noexcept { return ObjectPtr_; }
    [[nodiscard]] const T *operator->() const noexcept { return ObjectPtr_; }

    [[nodiscard]] const void        *BaseAddress() const noexcept { return RawView_; }
    [[nodiscard]] size_t             MappedSizeBytes() const noexcept { return MappedBytes_; }
    [[nodiscard]] constexpr size_t   DuplicatedEntityBytes() const noexcept { return 0u; }
    [[nodiscard]] bool               IsOsSharedMapping() const noexcept { return UsingOsSharedMapping_; }
    [[nodiscard]] const std::string &SegmentName() const noexcept { return SegmentName_; }

  private:
    void       *RawView_              = nullptr;
    T          *ObjectPtr_            = nullptr;
    size_t      MappedBytes_          = 0u;
    bool        UsingOsSharedMapping_ = false;
    std::string SegmentName_{};
#if defined(_WIN32)
    void       *MappingHandle_        = nullptr;
#endif
};

} // namespace Frontier::Drive
