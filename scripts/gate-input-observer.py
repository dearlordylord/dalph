#!/usr/bin/env python3
"""Cooperative Linux input observation; ordinary writes/replacements, not mmap containment."""
import ctypes
import json
import os
import select
import struct
import sys

libc = ctypes.CDLL(None, use_errno=True)
libc.inotify_init1.argtypes = [ctypes.c_int]
libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
if fd < 0:
    raise OSError(ctypes.get_errno(), "inotify_init1 failed")
MASK = 0x2 | 0x4 | 0x8 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x2000
ATTRIB = 0x4
ISDIR = 0x40000000
OVERFLOW = 0x4000
IGNORED = 0x8000
watches = {}
watched_paths = set()
visited = set()
roots = []
excluded = []
protected = []
replaceable = set()
replacement_counts = {}
active_replaceable_watches = {}
obsolete_replaceable_watches = {}
awaiting_parent_replacements = {}
paused = False


def send(kind, **fields):
    sys.stdout.write(json.dumps(dict(kind=kind, **fields)) + "\n")
    sys.stdout.flush()


def below(path, root):
    return path == root or path.startswith(root + os.sep)


def skip(path):
    if any(below(path, root) or below(root, path) for root in protected):
        return False
    return any(below(path, root) for root in excluded)


def relevant(path):
    return not skip(path) and any(below(path, root) or below(root, path) for root in roots + protected)


def declared_input(path):
    if any(below(path, root) for root in protected):
        return True
    return any(below(path, root) for root in roots) and not any(below(path, root) for root in excluded)


def only_strict_ancestor(path):
    inputs = roots + protected
    return any(path != root and below(root, path) for root in inputs) and not declared_input(path)


def invalidates(path, mask):
    # Directory timestamps and restored permissions can churn above an input
    # without changing its final bytes, modes, links, or resolution. Membership
    # and replacement events still invalidate, and the final snapshot catches
    # a lasting ancestor change that alters the resolved input identity.
    metadata_only = mask & ~ISDIR == ATTRIB
    return relevant(path) and not (metadata_only and only_strict_ancestor(path))


def watch(path):
    if path in watched_paths:
        return
    wd = libc.inotify_add_watch(fd, os.fsencode(path), MASK | (0x02000000 if os.path.islink(path) else 0))
    if wd < 0:
        raise OSError(ctypes.get_errno(), "cannot watch " + path)
    watches.setdefault(wd, set()).add(path)
    watched_paths.add(path)
    if path in replaceable:
        active_replaceable_watches[path] = wd


def install_replaceable_generation(path):
    if not os.path.isfile(path):
        send("error", reason="replaceable input watch was not re-established because the file is absent",
             path=path[:1024])
        return False
    previous_wd = active_replaceable_watches.get(path)
    wd = libc.inotify_add_watch(fd, os.fsencode(path), MASK)
    if wd < 0:
        send("error", reason="replaceable input watch could not be re-established errno=" + str(ctypes.get_errno()),
             path=path[:1024])
        return False
    if previous_wd != wd:
        if previous_wd is not None:
            obsolete_replaceable_watches.setdefault(previous_wd, set()).add(path)
        watches.setdefault(wd, set()).add(path)
        watched_paths.add(path)
        active_replaceable_watches[path] = wd
    replacement_counts[path] = replacement_counts.get(path, 0) + 1
    if replacement_counts[path] > 1:
        send("error", reason="multiple replaceable input generations occurred before validation",
             path=path[:1024])
    return True


def watch_ancestors(path):
    parent = os.path.dirname(path)
    while True:
        if os.path.isdir(parent):
            watch(parent)
            canonical = os.path.realpath(parent)
            if canonical != parent:
                watch(canonical)
        if parent == os.path.dirname(parent):
            return
        parent = os.path.dirname(parent)


def walk(path):
    path = os.path.abspath(path)
    if skip(path):
        return
    parent = os.path.dirname(path)
    while not os.path.isdir(parent):
        parent = os.path.dirname(parent)
    watch(parent)
    if not os.path.lexists(path):
        return
    watch(path)
    if os.path.islink(path):
        target = os.path.realpath(path, strict=True)
        roots.append(target)
        watch_ancestors(target)
        walk(target)
        return
    if os.path.isdir(path):
        if path in visited:
            return
        visited.add(path)
        # The membership watch is installed before discovering descendants.
        with os.scandir(path) as children:
            for child in children:
                walk(child.path)
    elif not os.path.isfile(path):
        raise OSError("unsupported input " + path)


def drain():
    dirty_path = None
    dirty_mask = None
    dirty_name = None
    unresolved_replaceable_events = {}
    rearmed_paths = set()
    while True:
        try:
            data = os.read(fd, 1024 * 1024)
        except BlockingIOError:
            for path, mask in unresolved_replaceable_events.items():
                if path not in rearmed_paths:
                    send("error", reason="replaceable input watch was not re-established mask=" + hex(mask),
                         path=path[:1024])
            if dirty_path is not None:
                send("dirty", reason="input filesystem event mask=" + hex(dirty_mask) + " name=" + repr(dirty_name), path=dirty_path[:512])
            return
        if not data:
            raise OSError("inotify EOF")
        offset = 0
        while offset < len(data):
            if len(data) - offset < 16:
                raise OSError("truncated inotify event header")
            wd, mask, cookie, length = struct.unpack_from("iIII", data, offset)
            offset += 16
            if offset + length > len(data):
                raise OSError("truncated inotify event name")
            name = os.fsdecode(data[offset:offset + length].split(b"\0", 1)[0])
            offset += length
            if mask & OVERFLOW:
                send("error", reason="IN_Q_OVERFLOW: input observation lost events")
            elif mask & 0x2000:
                send("error", reason="unexpected watch removal or unmount mask=" + hex(mask),
                     path=", ".join(sorted(watches.get(wd, {"<unknown watch>"})))[:1024])
            elif mask & IGNORED:
                paths = watches.pop(wd, {"<unknown watch>"})
                for path in paths:
                    obsolete = path in obsolete_replaceable_watches.get(wd, set())
                    if obsolete:
                        obsolete_replaceable_watches[wd].discard(path)
                        if not obsolete_replaceable_watches[wd]:
                            obsolete_replaceable_watches.pop(wd)
                        continue
                    if path in replaceable and active_replaceable_watches.get(path) == wd:
                        watched_paths.discard(path)
                        active_replaceable_watches.pop(path)
                        if install_replaceable_generation(path):
                            rearmed_paths.add(path)
                            awaiting_parent_replacements[path] = awaiting_parent_replacements.get(path, 0) + 1
                        continue
                    send("error", reason="unexpected watch removal or unmount mask=" + hex(mask), path=path[:1024])
            elif wd not in watches:
                raise OSError("unknown inotify watch")
            else:
                for base in watches[wd]:
                    path = os.path.join(base, name) if name else base
                    if path in obsolete_replaceable_watches.get(wd, set()):
                        continue
                    if path in replaceable and not mask & (0x2 | 0x8):
                        if name and mask & (0x80 | 0x100):
                            awaiting = awaiting_parent_replacements.get(path, 0)
                            if awaiting > 0:
                                if awaiting == 1:
                                    awaiting_parent_replacements.pop(path)
                                else:
                                    awaiting_parent_replacements[path] = awaiting - 1
                            elif install_replaceable_generation(path):
                                rearmed_paths.add(path)
                            continue
                        unresolved_replaceable_events[path] = unresolved_replaceable_events.get(path, 0) | mask
                        continue
                    if invalidates(path, mask):
                        dirty_path = path
                        dirty_mask = mask
                        dirty_name = name
                        break


try:
    config = json.loads(sys.stdin.readline())
    roots = list(dict.fromkeys([os.path.abspath(path) for path in config["roots"]] + [os.path.realpath(path) for path in config["roots"]]))
    excluded = [os.path.abspath(path) for path in config["excludedRoots"]]
    protected = [os.path.abspath(path) for path in config.get("protectedRoots", [])]
    replaceable = set(os.path.abspath(path) for path in config.get("replaceableRoots", []))
    if not replaceable.issubset(set(protected)):
        raise OSError("replaceable inputs must also be protected inputs")
    for root in list(roots):
        watch_ancestors(root)
        walk(root)
    drain()
    send("ready", version=1)
    while True:
        readable, _, _ = select.select([sys.stdin] + ([] if paused else [fd]), [], [])
        if fd in readable:
            drain()
        if sys.stdin in readable:
            line = sys.stdin.readline()
            if not line:
                break
            request = json.loads(line)
            command = request["command"]
            if command == "close":
                break
            if command == "pause":
                paused = True
            elif command == "drain":
                drain()
                replacement_counts.clear()
            elif command == "protect":
                added = [os.path.abspath(path) for path in request["roots"]]
                protected.extend(added)
                for path in added:
                    # Revisit excluded trees once protected; inode watches remain sticky.
                    visited.discard(path)
                    watch_ancestors(path)
                    walk(path)
                drain()
            else:
                raise OSError("unsupported observer command")
            send("ack", requestId=request["requestId"])
except Exception as error:
    send("error", reason=str(error)[:1024])
    sys.exit(1)
finally:
    os.close(fd)
