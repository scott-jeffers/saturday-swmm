/* getrusage shim for Windows builds (Basilisk only uses it for stats). */
#pragma once
#include <string.h>
#include <sys/time.h>
#define RUSAGE_SELF 0
struct rusage { struct timeval ru_utime, ru_stime; long ru_maxrss; };
static inline int getrusage (int who, struct rusage * r) { (void) who; memset (r, 0, sizeof (*r)); return 0; }
