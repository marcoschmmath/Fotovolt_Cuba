# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase: React 18 + TypeScript 5.7 + Vite 6 + Vitest 2, Bun 1.4.5 as the
exclusive package manager, custom CSS design system, custom PWA service worker,
localStorage persistence, custom SVG charts and hash routing. Mobile-first PWA
aimed at Android phones; no backend, no Python/Julia runtimes.

## Users

Primary users are Cuban households deciding whether to invest in a photovoltaic
installation, and the installers who advise them (advanced details must stay
reachable for the installer but must not burden the customer).

Their situation: interrupted grid supply, expensive and hard-to-source equipment,
cooking that may or may not be possible electrically during an outage, and a
need to decide between battery/inverter/panel alternatives before spending money.

The job: understand what a proposed installation can actually supply at home,
for how long, when it stops being enough, which component is the bottleneck,
and what compromises (cooking with charcoal or gas, less daytime comfort,
dropping optional loads) would be required.

## Product Purpose

SolarAPP lets a household configure its own consumption once (appliances,
routines, cooking habits, essential night loads, alternative cooking fuel) and
then evaluate any number of alternative solar installations against it, using a
transparent 15-minute energy simulation over 24 representative grid-return
scenarios plus a full 24-hour national-grid blackout, with both usual and
flexible electrical-preparation behaviour.

Success means the customer can judge the investment honestly: no fabricated
curves, no false verification of missing equipment data, no guaranteed
performance where only an estimate exists.

## Positioning

The simulation is deliberately simplified and conservative, not an electrical
design certification and not a high-fidelity electrochemical model. Safety
margins are explicit and configurable rather than hidden multipliers. Missing
equipment data yields an explicit "insufficient information" state, never an
invented specification. An externally offered system can be evaluated against
the customer's own saved household profile, and offers are saved for later
comparison instead of being thrown away.

## Operating Context

Used on a phone, often with intermittent connectivity (the app works offline
after first load). Prices, brands and equipment come from the installer or from
public datasheets the user enters themselves. The household is configured once
and reused; installations are replaceable. Spanish (es-CU) is the product
language.

## Capabilities and Constraints

- Entities are strictly separate: `HouseholdProfile` (consumption and habits),
  `SystemConfiguration` (installation proposal, linked to a household),
  `SimulationResult` (immutable snapshot with both snapshots inside). Editing an
  installation never changes household consumption; deleting a household never
  silently deletes its historical results.
- Grid availability model: 24 deterministic representative return scenarios
  (one continuous 3-hour window per day, starts hourly 00:00–23:00, windows may
  cross midnight) plus one mandatory 24-hour total blackout. Every installation
  and behaviour variant uses exactly the same scenario set. The 24 cases are a
  representative analysis, not a claim about the empirical distribution of
  blackouts.
- Cooking is modelled as three independent activities (breakfast, lunch,
  dinner) with a meal-serving hour distinct from an acceptable preparation
  window. Alternative fuel (charcoal/gas) substitutes electrical cooking when
  the household allows it; substituted meals are reported, never counted as
  unmet electrical demand. Behaviour scenarios: usual preparation times, and
  flexible preparation within the configured window (meal time unchanged).
- Night-time comfort: essential night loads are identified in the household
  profile; the battery keeps a reserve derived from that real night demand
  (not an arbitrary fixed percentage), respecting manufacturer DoD and minimum
  SOC.
- Default hybrid dispatch policy: while grid is available it serves the loads
  (grid electricity is inexpensive and the battery is preserved for outages);
  PV serves loads and/or charges the battery; when the grid is down, PV serves
  loads, surplus charges the battery, and the battery covers the rest within
  its limits. Grid charging only happens when the inverter actually declares an
  AC charger.
- Household grid import has one centralized provisional default
  (`DEFAULT_CUBA_RESIDENTIAL_GRID_LIMIT_W = 3000`), not presented as an official
  standard, with an advanced installer-only override; it is distinct from the
  inverter's grid-charging power.
- Grid export is removed: excess PV is reported as curtailed/unutilized energy.
  Old persisted configurations migrate without export parameters.
- Offer checker: select an existing household, enter the offered equipment, one
  primary action ("Simular esta oferta en mi vivienda") runs compatibility
  checks and the full simulation, and the result is comparable with saved
  installations. Missing specifications never produce a verified status.
- Undecided by design: real solar-resource data, market prices beyond what the
  user enters, and any guarantee of performance. Values are hypotheses or
  user-provided data, displayed as such.

## Brand Commitments

Existing name and voice: SolarAPP / "Calculadora solar Cuba", Spanish, plain
and honest tone aimed at non-technical customers. The app must feel like a
professional energy-planning product, not a generic SaaS dashboard: the
established design direction is "Solar Tech Editorial" (warm paper ground,
deep forest green and solar lime used sparingly, serif display type for
figures, one memorable dark-green energy-flow panel). Emoji are not used as
iconography.

## Evidence on Hand

- Original internal engineering review (`INFORME-REVISION.md`, read from git
  history at commit af11990) with C1–C8 critical and M1–M25 additional
  findings; the previous implementation round is documented in
  `IMPLEMENTATION-REPORT.md`.
- `REPAIR-PLAN.md` documents the earlier repair roadmap and baseline.
- No measured meteorological data, no curated market price database, and no
  real device datasheets ship with the repo: equipment data must remain
  user-entered or reference values explicitly marked as such.

## Product Principles

1. Physical honesty over comfort: a conservative, explainable model beats a
   sophisticated one with unjustified assumptions.
2. The household is the durable unit; installations are disposable experiments.
3. Missing data is a state, not a default.
4. Results must be understandable by a non-technical customer without hiding
   the technical detail from an installer.
5. Every historical result is a snapshot: numbers never silently change when
   the inputs are edited.

## Accessibility & Inclusion

WCAG 2.2 AA as the practical target (contrast, keyboard interaction, focus
visibility, screen-reader labelling, semantic HTML, form validation, touch
target sizes), plus full `prefers-reduced-motion` support. Mobile-first for
Android phones with comfortable touch targets; text and controls must remain
usable at default font scale.