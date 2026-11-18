/* Force-included (-include wincompat.h) for Windows builds of Basilisk output. */
#pragma once
#ifdef _WIN32
#include <signal.h>
struct sigaction { void (*sa_handler) (int); int sa_mask; int sa_flags; };
#define SA_RESETHAND 0
static inline int sigemptyset (int * s) { *s = 0; return 0; }
static inline int sigaction (int sig, const struct sigaction * a, struct sigaction * o)
{ (void) o; signal (sig, a->sa_handler); return 0; }
#endif
