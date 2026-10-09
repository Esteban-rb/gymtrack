# GymTrack verification: automated evidence and pending manual checks

Automated tests cover the setup gate, reviewed apply, recovery paths, and large-history data handling. They do **not** establish browser, installed-PWA, native, operating-system, or device-performance behavior. The feature is not declared wholly verified or release-ready by this report.

## Current automated evidence

| Evidence | Observed result | Does not establish |
| --- | --- | --- |
| Current full test suite (independently accepted) | `npm test`: 263 tests passed in 27 files; no unhandled errors reported. | Browser/native behavior or device performance. |
| Large-history coverage | Focused command passed 10 tests in 2 files. Fixture: 900 sessions, 1,800 sets, 3 periods; mounted History selection preserved database contents and store-cache identities. | Real-user-data performance or a device benchmark. |
| Root setup verification (independently accepted) | Focused command passed 30 tests in 4 files. Mounted profile save/reload remained gated until real reviewed apply; invitation, skip/reopen, and failure-retry paths were exercised. | Manual usability, browser accessibility, or installed-PWA behavior. |
| Local-date fixture checks (earlier verification) | `src/setup-store.test.js` passed 7 tests in both America/Los_Angeles and UTC. | A fresh timezone matrix in this report; it was not rerun here. |
| Production build (independently accepted) | `npm run build` passed; Vite transformed 56 modules and generated the service worker. | PWA installation, offline use, or update behavior. |

The full-test, root, timezone, and build results above are prior independently accepted evidence, not commands run while authoring this document. The history result is likewise previously accepted. This documentation-only task adds no test evidence.

## Quick path

1. For automated regression checks after an authorized code change, run `npm test` and `npm run build` from the project root. The package scripts map to `vitest run` and `vite build`.
2. Do not treat passing tests or service-worker generation as browser/offline approval. The agent did not start a server or browser.
3. Manual checks below remain **PENDING** until a maintainer runs them in an approved, disposable test environment and records observations.

## Behavior covered by automated evidence

| Area | Verified contract |
| --- | --- |
| First run | Seed-only users enter the required Wizard. Saving only the profile, including after reload, does not clear the obligation; a committed reviewed apply does. |
| Existing users | The invitation is nonblocking. Not now persists skip; Settings can reopen setup for skipped or complete users. Failures remain visible and retryable. |
| Local routine setup | Import previews do not replace the manual draft until explicit Use. Back retains draft, schedule, and goal; stale routine codes remain blocked. |
| Continuation | A pin targets the exact existing unfinished workout and period. A real committed finish can return to review; failed finish remains in continuation. Set history and saved workout identity are retained. |
| History scale | A synthetic fake-IndexedDB fixture covers 900 workouts across two archived and one active period, with 1,800 sets. Repeated cycle/variant records remain separately addressable; same-day prior lookup uses workout ID ordering. |
| Existing behavior | The old app-shell smoke fixture is a valid historical, dismissed user rather than a seed-only profile with fabricated completion. Existing assertions remain. |

Profile demographics are stored as entered; medal behavior is unchanged. This report makes no physiology, multiplier, or unit-conversion claim.

The large-history fixture is synthetic test data. It is not a performance benchmark, and test execution time is not a performance result. The implementation rereads/rebuilds history during initialization; no bottleneck has been measured. Auto-finish suppression after a failed auto-finish has source-level coverage; do not infer exhaustive UI race coverage from that check.

## Manual checklist — all pending

Use an approved test build and disposable browser profile/origin. Preserve real user storage and backups; do not clear application storage, change the system clock, or use production data. Use a valid historical fixture for history/partial-session checks. If one is unavailable, leave that row pending rather than fabricating it.

| Status | Manual check | Record expected and observed result |
| --- | --- | --- |
| PENDING | Fresh first run: complete profile, leave/reload, confirm profile-only save remains gated; complete routine/schedule/review/apply. | No tabs or skip/close bypass before commit; normal app appears only after apply. |
| PENDING | Existing-user invitation: use Not now, reload, then reopen from Settings and cancel profile editing. | Skip persists; reopen is optional; cancel returns to the original tab without applying. |
| PENDING | Reopen after a completed setup; inspect saved preferences and history. | Wizard remains open until cancel or committed apply; existing data remains intact. |
| PENDING | Select local CSV, JSON, XLSX, and XLS files; include an ambiguous workbook with exact Unicode sheet names where available. | Preview is local; only explicit Use hands off to an editable draft and Review. Manual draft is retained on failure/cancel. Backup restore is a separate operation. |
| PENDING | Continue a real partial session; separately exercise finish, restart, and cancel choices. | Continue uses the selected old session; restart/cancel are explicit; history IDs, snapshots, and sets remain. Do not count navigation alone as a finish. |
| PENDING | Check weekly schedule with Monday-first weekdays, rest slots, initial-week behavior, and a missed Monday; check independent rotation after an eligible completion. | Observe actual schedule/progress behavior; do not infer automatic stopping at the cycle goal. |
| PENDING | Check cycle-goal choices and older Settings controls. | Review accepts integer goals 4–8; retain existing legacy Settings choices 4, 6, and 8. |
| PENDING | Keyboard/focus order, responsive layouts, reduced-motion preference, and accessible errors. | Record browser, viewport/device, inputs, and observed focus/visual behavior. |
| PENDING | Installed PWA reload, offline launch, and update behavior on available devices. | Record only behavior directly observed; service-worker generation is not offline proof. |
| PENDING | Large-history browser/device profiling using a disposable representative dataset. | Record actual record counts, cold/warm load, Today/Metrics/History interactions, long tasks, and memory observations. No threshold is supplied by this report. |
| PENDING | Native/OS checks on available supported devices. | Record device/OS and observations. The native assessment binary is unavailable; no approval is implied. |

## Safe manual procedure

Only a human maintainer should start a server or browser, after approving the environment and disposable data. For preview, the loopback-only command is:

```sh
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
```

Do not install browsers, automation, dependencies, or bypasses for these checks. The agent did not run preview or browser checks. Do not use Firefox automation flags or claim that an unobserved check passed.

## Result record template

```text
Date/time and timezone:
Reviewer:
Build/commit identifier (if available):
Browser/device/OS and version:
Test profile/origin and data source (disposable; no personal data):
Records: periods / workouts / sets:
Steps and expected result:
Observed result and evidence (anonymized):
Errors or deviations:
Optional measured metrics and method:
Status: PASS | FAIL | BLOCKED
Next action / owner:
```

A report with pending rows is a partial manual assessment, not an approval. Do not publish screenshots, logs, backups, or identifiers containing personal data. The working tree is uncommitted; no Git diff, commit, push, or release is part of this verification report.

## References

- [Root setup tests](../src/app-setup.test.jsx)
- [Large-history tests](../src/history-large-data.test.jsx)
- [Onboarding task context](../odd/tasks/gymtrack-onboarding.md)
