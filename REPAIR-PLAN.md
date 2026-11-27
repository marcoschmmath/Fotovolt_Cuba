# REPAIR-PLAN — SolarAPP (orchestrator baseline)

## Stage 0 — Baseline and protection (COMPLETE)

Recorded 2026-11-24 before any new source modification.

| Check | Result |
| --- | --- |
| Git status | branch `master`; HEAD `074b2f5` "Fase A — física crítica..."; base `af11990` |
| Working tree | `FIX-PLAN.md` and `INFORME-REVISION.md` **deleted** (left untouched per instruction); `skills-lock.json` modified; installed skills untracked |
| Lockfiles | `bun.lock` (Bun, valid) and `package-lock.json` (original npm, intact). Bun 1.4.5 available; Node v26.13.1 available |
| `bun run test` | **60 passed / 60** across 9 files (44 baseline + 16 added in Fase A) |
| `bunx tsc -b` | exit 0 |
| `bun run build` | exit 0 (`index-nmgo8wS0.js` 283.90 kB, gzip 88.84 kB) |
| Source size | ~7,284 lines across `src/` + `public/` |

**Protection rules:** no `git reset --hard`, no `git clean -fd`, no restore/overwrite of the two deleted review files, no npm/pnpm/yarn dependency commands, no commit without authorization.

## Important repository mapping (task brief vs. reality)

- Domain types live in `src/domain/core/types.ts` (+ `core/defaults.ts`), not `src/domain/types.ts`.
- Wizard steps live in `src/screens/wizard/`, not `src/screens/` directly.
- Root app is `src/App.tsx`; hash routing and state in `src/app/`.
- Vitest config currently discovers only `src/**/*.test.ts` (no `.tsx`).

## Already integrated before this plan (Fase A, commit 074b2f5)

Shared discharge budget (C1), shared charge budget (C2), unified DoD/minSOC (C3),
corrected `dailyRechargeKwh` (C4), unified autonomy (C5), PV data diagnostics (C6),
string feasibility / no arbitrary `3` series cap (C7), `NO_LOADS` state (C8).
Plus 16 new tests in `src/test/phaseA.test.ts`. **These must be verified, not assumed.**

## Implementation plan (phases, with file ownership)

| Phase | Scope | Owner | Depends on |
| --- | --- | --- | --- |
| 1 (A) | Verify + finish critical physics, invariants, regression tests | Agent 1 (domain) | baseline |
| 2 (B/C) | Persistence, catalog, forms, decimal input, data protection | Agent 2 (data) | Agent 1 contracts |
| 3 (D/E) | App state, charts, result/compare, wizard, PWA, a11y, reduced motion | Agent 3 (frontend) | Agents 1+2 contracts |
| 4 | Visual design system + result screen; `DESIGN.md` | Agent 4 (design) | Phase 3 integrated |
| 5 | Independent read-only audit | Agent 5 (auditor) | all integrated |
| 6 | Final validation + `IMPLEMENTATION-REPORT.md` | Orchestrator | Agent 5 findings |

## Remaining finding IDs to verify & close (from original review)

- **B:** M10 grid charge conversion efficiency, M11 single inverter efficiency source,
  M12 kWh/W unit clarity (`servedByPriority`/`unservedByPriority` → `…Kwh`),
  M13 multi-day recharge/elapsed time, M14 recharge per selected option,
  M15 PV strings (verify Fase A), M16 fractional grid indexing, M17 empty loads,
  M18 battery pack/module semantics; midnight-crossing unserved events, double-counted
  clipping losses, shared mutable objects, invalid minute formatting.
- **C:** M1 storage validation/migration/step clamping; C7 MPPT+AC voltage preservation;
  C8 negative temp coefficients; M2 decimal comma buffering; M7 selection side effects;
  M8 catalog validation; custom usage duration reset; expanded appliance IDs; contact save
  feedback; carousel pagination.
- **D/E:** M3 contrast; M4 SVG widths; M5 SW cache `response.ok`; M6 offer report invalidation;
  M19 wizard gate; M21 tabs/focus; M22 valid IDs; M23 CSS fallbacks; M24 reduced motion;
  M25 button content; stale quotes; clipboard errors; `aria-current`; meta; SW scope;
  persistence debounce; Vitest `.tsx` discovery.
- **L:** dead code/params cleanup, fixture sharing, docs (`README.md`, `DESIGN.md`).

## Orchestration reality (subagent availability)

**OpenCode subagent delegation is UNAVAILABLE.** Launching the four Stage 1 `explore`
subagents (math/simulation, data/persistence/forms, frontend/PWA/a11y, visual design)
returned: `Free usage limit reached. Connect a provider or subscribe to OpenCode Go
to keep going, or switch models.` All four sessions failed before producing any report.

Per the task's explicit contingency ("If subagent execution is unavailable or permissions
prevent delegation, report this honestly and execute the work sequentially"), the main
orchestrator executes every stage directly and sequentially. This is documented here and
will be repeated in `IMPLEMENTATION-REPORT.md`. No agent configs were created and OpenCode
global configuration was not modified.

## Success criteria

Physical defects fixed with failing-then-passing regression tests; data protected;
a11y/PWA improved; `tsc -b` + full test suite + production build green; independent audit
completed; limitations documented in `IMPLEMENTATION-REPORT.md`.
