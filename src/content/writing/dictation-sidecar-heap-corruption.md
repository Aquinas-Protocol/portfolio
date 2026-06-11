---
title: "The crash Python couldn't catch"
subtitle: "A Win32 heap-corruption RCA: a clipboard restore thread, rdpclip, and the watchdog that hid the bodies"
author: Dylan Palumbo
date: 2026-06-10
tags: [rca, reliability, win32, windows, debugging, dictation]
draft: false
---

I run a small voice-dictation bridge between my MacBook and a Windows host: hold a hotkey, speak, release, and the transcript pastes itself into whatever Windows application has focus over RDP. The Windows side is a Python sidecar that owns the paste, and its mechanics are deliberately boring. Save whatever text is currently on the clipboard. Put the transcript on the clipboard. Send Ctrl+V with `SendInput`. Then put the original text back, so dictating doesn't eat whatever you'd copied a minute earlier.

This is the story of that sidecar dying over and over for days, why two separate safety systems hid it from me, and what an uncatchable Windows crash teaches you about where to look when Python can't tell you anything.

## The symptom

In early June the sidecar started dying roughly 1.5 seconds after a successful paste. Not every paste. The worst observed run was two crashes in a seven-hour stretch of normal use.

The exit status was `0xc0000374`: `STATUS_HEAP_CORRUPTION`. That is a *fail-fast* termination. The Windows heap manager detects that its own internal structures are damaged and kills the process immediately, without unwinding. No Python traceback. No `except Exception` fires. No `atexit` handler runs. The rotating file log just stops, sometimes mid-line, and the process is gone.

If you haven't met this class of crash before: it is uncatchable from inside Python *by design*. Once the heap manager notices corruption, every byte of the process's memory is suspect, so the only safe move is to terminate on the spot. Whatever you're going to learn, you're going to learn it from outside the process.

## Why nobody noticed for days

Two safety systems conspired to hide the crashes, which is its own lesson in irony.

First, the sidecar runs under Task Scheduler with a self-heal trigger: a repeating check that relaunches it if it's not running. The interval was five minutes. So each heap-corruption death presented as, at worst, a five-minute dictation outage, and usually not even that, because my next dictation typically came after the restart had already happened. The watchdog was converting a hard crash into invisible flapping. From the user's chair, the tool felt "occasionally flaky" instead of "crashing on a timer," and those two perceptions trigger very different levels of investigation.

Second, there is a down-alert: a bot-side loop that posts to a channel when the sidecar's heartbeat goes stale. That alert was deliberately gated to stay silent until a *first* heartbeat from the Mac client had ever been seen, so that a half-deployed install wouldn't page me forever. The Mac heartbeat sender hadn't shipped yet. The alert that should have fired within minutes of the first crash was armed but dark, waiting on a signal that did not exist.

Worth naming both failure modes plainly, because they generalize: a self-heal without crash accounting converts hard failures into noise-floor flapping, and an alert gated on a signal that doesn't exist yet is an alert that doesn't exist.

## The hunt

You can't attach a debugger to a process that's already gone, and you can't log your way out of a crash that kills the logger. When the failure is uncatchable in-process, the operating system is your stack trace. Three pieces of environmental evidence carried the whole investigation:

1. **Task Scheduler history.** The restart events were all there, timestamped, going back days. The crash wasn't new; my awareness of it was.
2. **The file log going quiet mid-line.** That ruled out clean exits, signal handling, and anything that flows through normal teardown. The process was being terminated externally, mid-thought.
3. **The timing constant.** Every death landed about 1.5 seconds after a successful paste. Crashes that follow a fixed delay after a known event are gifts: somewhere in the codebase, that constant has a name.

It did: the clipboard restore delay. After sending Ctrl+V, the sidecar handed the old clipboard text to a daemon thread, `_restore_clipboard_later`, which slept 1.5 seconds and then wrote it back to the clipboard. The delay existed for a legitimate reason (more on that below), but the *thread* existed only as an optimization, so the paste call could return without waiting out the delay. That optimization turned out to be the bug.

## Root cause

The paste path's own `SetClipboardData` doesn't just set data. Over RDP it wakes `rdpclip.exe`, the clipboard-sync agent, which immediately starts reading the clipboard to mirror it to the other side of the session. So the sequence on every dictation was:

1. Paste worker thread writes the transcript to the clipboard and sends Ctrl+V.
2. `rdpclip.exe` wakes up and begins syncing the new clipboard contents across the RDP session.
3. 1.5 seconds later, a *different* thread in my process performs a second full Win32 clipboard transaction (open, empty, set, close) to restore the old text, concurrently with whatever step 2 is still doing.

The Win32 clipboard is a single global lock with per-thread owner state. Interleaving open/empty/set across threads while an external process is mid-sync is exactly the kind of cross-thread clipboard handling the API's documentation quietly warns about, and on some interleavings it corrupted my process's heap. Intermittently. On a timer I had written myself.

The fix's docstring in the paste module now carries the RCA, the way I think production code should:

> *Deliberately NOT a background thread. The old daemon-thread version did its Win32 clipboard write ~1.5s post-paste, concurrently with rdpclip.exe's RDP clipboard sync (which the paste's own SetClipboardData had just woken), and that intermittently corrupted the process heap (0xc0000374) — a fail-fast crash Python can't trap — hard-killing the sidecar (RCA 2026-06-08).*

## The fix

Three moves, all structural rather than defensive:

**Delete the thread.** The restore now runs inline on the paste worker, which is already off the event loop and already serialized. The paste call takes 0.3 seconds longer to return; nobody can perceive it.

**One lock for every clipboard touch.** A process-wide `threading.Lock` now serializes all clipboard access, so the one remaining concurrency case (two near-simultaneous dictations) can't interleave clipboard transactions either:

```python
# Serialize ALL clipboard access in this process onto one critical section. The
# Win32 clipboard is a single global lock with per-thread owner state; letting
# two threads (e.g. two near-simultaneous dictations) interleave open/empty/set
# is the kind of cross-thread clipboard handling that corrupts the heap.
_clip_lock = threading.Lock()
```

**Question the delay itself.** The 1.5-second wait existed because WinUI targets (the new Notepad, for one) read the clipboard *asynchronously* after Ctrl+V, and restoring too early would paste the wrong text into them. But Win32 and Electron apps read synchronously. 0.3 seconds is ample for the async readers, so the delay dropped by 1.2 seconds. The crash investigation made the latency better.

Two supporting details earned their keep. `OpenClipboard` got a short bounded retry, because `rdpclip.exe` and clipboard managers grab the global lock transiently and the first attempt can lose a race the next one wins. And the restore stays best-effort: a failure there is logged and swallowed, never raised, because the paste already happened and an exception would fall through to the typing fallback and double-insert the text.

## Fixing the safety net too

A root-cause fix that leaves the masking layers in place is half a fix. The same week:

- The watchdog interval went from five minutes to one. A crash now costs at most a minute of availability, and the change was one line in the scheduled-task trigger.
- I validated it the only way that counts: hard-killed the live process and timed the recovery. About 59 seconds.
- The missing Mac-side heartbeat shipped. The client now beacons every 60 seconds into a health table; a bot-side loop posts one alert when the heartbeat goes stale and an all-clear on recovery; `launchd` keeps the Mac client itself alive. The alert that was gated off is now armed by real data, and it has since caught a genuine outage.

## Results and what I'd generalize

Before the fix: two crashes in seven hours. After: zero in the first seventeen hours of monitored use, and none since. Plus 1.2 seconds shaved off every dictation's restore path.

Four lessons I'd carry to any system:

1. **A watchdog without crash accounting hides exactly the failures it exists to absorb.** Restart events are a metric to surface, not an implementation detail. If the supervisor doesn't count its own interventions, it is laundering crashes into uptime.
2. **An alert gated on a signal that doesn't exist yet is an alert that doesn't exist.** Gate conditions deserve the same review as alert conditions; "silent until first heartbeat" is correct only if the heartbeat sender actually shipped.
3. **The Win32 clipboard is a global, single-owner resource.** One thread, one lock, no "later." Any design where a background thread touches it on a delay is a latent crash, whether or not it has fired yet.
4. **When the failure is uncatchable in-process, move the investigation to the OS.** Exit codes, scheduler history, and the timestamps of a log that stops mid-line are the stack trace. The 1.5-second constant was sitting in the evidence from the first day; environmental data is only useless until you correlate it.

None of this required a debugger, a crash dump, or anything exotic. It required taking a boring exit code seriously and refusing to let two layers of self-healing infrastructure keep the secret.

*Dylan Palumbo, 2026-06-10*

*Source: a personal voice-dictation bridge (MacBook → Windows host). The production paste path and its tests are private; the patterns are not.*
