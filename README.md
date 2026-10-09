# GymTrack

GymTrack is a personal gym-training tracker. It records workout sets, organizes routines and mesocycles, and shows training history, metrics, and records. Data is stored locally in the browser using IndexedDB.

**Current handoff:** the onboarding/routine configuration implementation and available automated checks are complete. Real-browser, installed-PWA, device, and performance verification remain pending. Passing tests does not mean the entire audit is complete or the application is release-approved.

## Run locally

Use a Node.js version compatible with the `engines` field in [package.json](package.json). Dependencies are already installed in the current working copy. For a fresh checkout, use `npm ci` only when dependency installation/network access is permitted.

Run these commands from the repository root:

```bash
# Development server
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/**. Alternatively, preview the production build:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
```

Open **http://127.0.0.1:4174/** and keep the terminal running. These addresses are local to the same computer, not public deployments. `--strictPort` prevents silently switching to another port.

For verification, use a disposable browser profile and test data. Browser storage belongs to its profile and origin; changing ports does not transfer existing data. Do not clear real application storage or use your only copy of a backup for testing.

## Project context

| Area | Purpose |
| --- | --- |
| Home / Today | Inspect the training plan and record actual workout sets. |
| Metrics / Records | Inspect progress, volume, and personal records. |
| History | Browse active and archived periods while preserving separate workout identities. |
| Settings | Manage preferences, backups, mesocycle controls, and reopen configuration. |
| Setup Wizard | Collect a profile, prepare a routine, choose a schedule, and explicitly review/apply it. |

The stack is React, Vite, Zustand, and Dexie/IndexedDB. SheetJS handles local spreadsheet decoding. Vitest, jsdom, and fake IndexedDB support automated tests. `vite-plugin-pwa` generates the service worker; installed/offline behavior still needs browser verification.

## Implemented work

- **Profile and onboarding:** name, sex, age, height, and bodyweight validation. Seed-only first-run users must finish reviewed configuration; saving the profile alone does not remove that requirement, including after reload. Existing users have an optional invitation, persisted skip, and reopening from Settings.
- **Editable routine drafts:** manual editing and local CSV, JSON, XLSX, and XLS import. Ambiguous workbooks offer explicit sheet selection. Previewing an import does not replace a draft until explicit acceptance. Routine import and backup restoration are separate operations.
- **Scheduling:** fixed Monday–Sunday assignments with rest days, or independent ordered rotation. Previewing dates does not advance training progress.
- **Reviewed, atomic application:** profile/routine completion and related writes commit together. An empty mesocycle may be reused; an occupied one is archived and replaced without discarding historical definitions, IDs, snapshots, or sets.
- **Partial-session handling:** the user can continue the exact old session, explicitly restart, or cancel. Navigation does not fabricate sets or finish workouts. Finish errors remain visible and retryable; an automatic-finish failure does not discard an already saved set.
- **Consistency and maintenance:** repeat-safe Excel backup merging, chronological bodyweight handling, same-day record identity, restored screens/icons, and compatible dependency security patches.

### Rules that must remain intact

- Profile demographics do not introduce physiological multipliers or change existing medal rules.
- New reviewed configuration accepts integer cycle goals **4–8**; legacy Settings choices **4, 6, and 8** remain unchanged elsewhere.
- Weekly cycles follow calendar weeks, advance on Monday even when sessions are missed, and do not automatically stop at the cycle goal. Independent rotation advances only on an eligible actual first completion.
- Import/draft/preview actions must not prematurely persist a new routine or mutate historical data.
- Busy profile/review operations must not be bypassed by parent navigation controls. Failed writes must not produce false completion or discard existing data/preferences.

## Verification recorded at this handoff

| Check | Previously observed independent result |
| --- | --- |
| `npm test` | **263 tests passed in 27 files**, with no unhandled errors reported. |
| `npm test -- src/history-large-data.test.jsx src/metrics.test.js` | **10 tests passed in 2 files**. |
| Root setup / Wizard / setup-store focused group | **30 tests passed in 4 files** in the earlier root-integration verification. |
| Local-date setup-store fixture | **7 tests passed** in each of UTC and America/Los_Angeles in the earlier timezone verification. |
| `npm run build` | Production build and service-worker generation passed. |

The large-history fixture uses **900 workouts, 1,800 sets, and three periods**: two archived and one active. It checks reload identity/content, grouped sets, repeated sessions, same-day prior-session ordering, and mounted History selection without database/cache mutations. It is synthetic fake-IndexedDB/jsdom coverage, **not a browser/device performance benchmark**.

These results were recorded before this README was written; tests/build were not rerun for this documentation-only addition. Rerun them after behavior changes. See [the verification report](docs/verification.md) for commands, evidence limits, and a manual result template.

## Remaining work

| Pending area | What still needs to be observed |
| --- | --- |
| Real-browser end-to-end flows | First setup/reload/apply, optional invitation/skip/reopen, actual file selection/import, and partial-session continuation/restart/cancel. |
| Usability and accessibility | Keyboard/focus behavior, responsive layouts, reduced motion, and errors on target browsers/devices. |
| Installed PWA | Installation, offline launch, reload, and service-worker updates on available devices. A generated service worker is not proof of these behaviors. |
| Calendar/device behavior | Weekly rest/Monday boundaries and independent completion progress in actual use, without changing the real system clock or fabricating sets. |
| Performance | Cold/warm loading and Today/Metrics/History interactions with representative histories; record browser/device, data counts, long tasks, and memory observations. No measured bottleneck or device performance budget has been established. |
| Additional race coverage | Some in-flight context changes and exhaustive UI combinations remain source-guarded. A failed auto-finish/manual retry is tested; suppression after another logged set is not separately exercised. |
| Environment blockers | Automated browser launch was blocked and must not be bypassed. The native assessment binary is unavailable; independent verification is not native review approval. Unreadable Git objects remain unrepaired. |
| Delivery | Changes from this work remain uncommitted and unpublished. No commit, push, or release was performed. |

The next step is the [pending manual verification protocol](docs/verification.md), using an approved, disposable environment. Record actual observations; leave unavailable checks pending rather than treating automated tests as a substitute. Do not install/bypass browser tooling or repair/publish Git state without separate authorization.

## Code and continuity map

| Location | Responsibility |
| --- | --- |
| [src/App.jsx](src/App.jsx), [src/screens/](src/screens/) | Root navigation/setup gate and application screens. |
| [src/store.js](src/store.js), [src/db.js](src/db.js) | Zustand actions and local IndexedDB persistence. |
| [src/setup.js](src/setup.js), [src/schedule.js](src/schedule.js) | Profile/setup rules and schedule validation/selection. |
| [src/routine-draft.js](src/routine-draft.js), [src/routine-import.js](src/routine-import.js) | Editable routine model and local file decoding. |
| [src/metrics.js](src/metrics.js) | History/metrics calculations and prior-set lookup. |
| [docs/verification.md](docs/verification.md) | Accepted evidence and pending manual checklist. |
| [odd/tasks/gymtrack-onboarding.md](odd/tasks/gymtrack-onboarding.md) | Implementation progress, constraints, and recovery context. |

Protect real training data and backups when continuing work. The outstanding browser/device/performance checks keep the final verification task open.
