---
title: "The update race that bricked my desktop AI for two hours"
subtitle: "Event-log forensics on a Windows MSIX auto-update failure: a GPU crash, a surviving child process, a missing integrity catalog, and the quiesce ritual that fixed it"
author: Dylan Palumbo
date: 2026-08-29
tags: [windows, msix, appx, debugging, root-cause-analysis, event-logs, open-source]
draft: true
---

<!--
evidence (staging note — all claims sourced from wiki/log.md §2026-08-27 (RCA verified + FILED
#90147), §2026-08-28 (native-host relocation + controlled update EXECUTED), §2026-08-29 (CIG root
cause unified + first clean preflight PASS)):
exit code 101457950 GPU crash at 18:43:46, 3s after a browser-pane permission grant; deferred update
events 638/658; 17× event 5224 access-denied on chrome-native-host.exe lock; deployment errors
0x80073CF6/0x80073D05; Modified/NeedsRemediation; CodeIntegrity 3033 on vk_swiftshader.dll +
3010 ×3 (missing CodeIntegrity.cat) one second before "GPU process gone"; issue filed as
anthropics/claude-code#90147, comments on #80444/#81992 all Dylan-approved and posted (ids in log);
quiesce ritual validated 2026-08-28: registered in 55 s, zero 5224, zero error-level events, vs 17
locks / 3 errors / 2 h outage on 8/26; preflight = 14-check read-only script, exit 0 on 2026-08-29;
winget "fix" delivers the non-MSIX build and loses the VM/Cowork feature per #80444 thread analysis.
NOT named anywhere: hostnames, local user paths.
-->

On August 26 my desktop AI client died mid-workflow and would not come back for two hours. What follows
is the chain I reconstructed from Windows event logs, why it turned out to be one bug rather than two,
and the two artifacts that came out of it: an upstream bug report and a preflight check that has caught
the dangerous state before every update since.

## The visible failure

The app vanished during normal use. Relaunch failed. The package manager showed the installation in a
`Modified / NeedsRemediation` state, and recovery took a remove-and-reinstall cycle plus most of an
evening.

The updater log told the first half of the story. An auto-update had **staged** the new version earlier
that day but **deferred registration** because the app was running (AppX events 638/658). When the app
died and servicing tried to finish the job, package-data cleanup failed seventeen times with
access-denied (event 5224): a `chrome-native-host.exe` child process — spawned so the browser can talk
to the app, and owned by Chrome's lifecycle rather than the app's — was still alive and holding a file
lock inside the package directory. Deployment then failed outright (0x80073CF6 / 0x80073D05) and the
package stuck in the remediation state.

## The second half, from a stranger's comment

I filed the race as an upstream issue with the log-verified timeline. A community reporter on a related
issue then pointed somewhere I had not looked: the Code Integrity operational log.

It matched exactly. One second before the updater log recorded "GPU process gone," CodeIntegrity logged
event 3033: the app, running from the staged-but-deferred package directory, tried to load
`vk_swiftshader.dll` and failed signing-level requirements, alongside three 3010 events saying the
package's `CodeIntegrity.cat` catalog could not be loaded at all.

That collapsed two suspected bugs into one. The deferral race had left the staged package
integrity-incomplete: no catalog. The next lazy DLL load out of that directory got killed by the loader,
which took down the whole app, which handed servicing a corpse still guarded by the one child process
that outlives it. The "GPU crash" and the "update race" were the same defect observed from two logs.

## What shipped

- **The upstream report**, with the event-log evidence bundle, plus follow-up comments answering the
  open "how does the catalog go missing" question and flagging that the commonly suggested
  reinstall-via-package-manager fix silently swaps you onto a different build type that drops a feature.
- **A quiesce ritual for updates**: exit the app from the tray, close the browser (which kills the
  native-host child), stop the companion service, reboot. First validated run: the same update that
  previously produced 17 lock failures and a 2-hour outage registered cleanly in 55 seconds with zero
  errors.
- **A 14-check read-only preflight script** that inspects package status, process origins, the
  staged-but-deferred state, guard tasks, backup freshness, and the last 48 hours of AppX and
  CodeIntegrity events, and exits nonzero on anything suspicious. It now runs before every update
  window; three days after the incident it returned its first fully clean pass.

## What I took away

1. **Processes your app spawns but does not own will outlive it.** Anything holding a handle inside a
   package directory turns a routine update into a race.
2. **"Staged but deferred" is a real state, not a detail.** It is observable (events 638/658), it is
   exactly when the package is most fragile, and a health check can watch for it.
3. **Verify what a suggested fix actually delivers.** The popular workaround genuinely recovers the app
   and quietly costs a capability; that trade belongs in the issue thread, stated plainly.

The full timeline, event IDs, and evidence bundle are in the public issue:
[anthropics/claude-code#90147](https://github.com/anthropics/claude-code/issues/90147).
