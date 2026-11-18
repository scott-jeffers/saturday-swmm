/* Minimal mmap/munmap shim for Windows builds of Basilisk's virtual memindex. */
#pragma once
#include <windows.h>
#include <stddef.h>
#define PROT_READ 1
#define PROT_WRITE 2
#define MAP_PRIVATE 2
#define MAP_ANONYMOUS 0x20
#define MAP_FAILED ((void *) -1)
static inline void * mmap (void * addr, size_t len, int prot, int flags, int fd, long off) {
  (void) addr; (void) prot; (void) flags; (void) fd; (void) off;
  void * p = VirtualAlloc (NULL, len, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
  return p ? p : MAP_FAILED;
}
static inline int munmap (void * addr, size_t len) {
  (void) len;
  return VirtualFree (addr, 0, MEM_RELEASE) ? 0 : -1;
}
#define MADV_DONTNEED 4
/* Basilisk only calls this on pages it has already emptied: a no-op is safe. */
static inline int madvise (void * addr, size_t len, int advice) { (void) addr; (void) len; (void) advice; return 0; }
