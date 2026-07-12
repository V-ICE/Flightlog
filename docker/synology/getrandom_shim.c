/* getrandom() shim for Linux kernel < 3.17 (e.g. Synology DS412+ kernel 3.10).
 * Provides the getrandom() glibc wrapper using /dev/urandom as fallback.
 * Loaded via /etc/ld.so.preload so Apache never sees ENOSYS. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <unistd.h>
#include <sys/types.h>
#include <errno.h>

ssize_t getrandom(void *buf, size_t buflen, unsigned int flags) {
    int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    ssize_t n = read(fd, buf, buflen);
    close(fd);
    return n;
}
