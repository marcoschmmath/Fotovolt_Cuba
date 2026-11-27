import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../core/defaults';
import { defaultCookingActivities, type CookingActivity } from '../household/types';
import { planCooking, preferredPrepStartHour, type CookingPlanInput } from './cooking';

const params = { ...DEFAULT_PARAMS, stepMinutes: 15 };
const COUNT = 96;

function base(overrides: Partial<CookingPlanInput> = {}): CookingPlanInput {
  return {
    activities: defaultCookingActivities(),
    baseDemandW: new Array<number>(COUNT).fill(200),
    pvAvailableAcW: new Array<number>(COUNT).fill(0),
    gridAvailable: new Array<boolean>(COUNT).fill(false),
    inverterAcLimitW: 3000,
    batteryAcLimitW: 2500,
    gridImportLimitW: 3000,
    params,
    mode: 'usual',
    substitution: 'electric-first',
    hasFuel: false,
    ...overrides,
  };
}

/** Actividad con identificador único para probar independencia. */
function activity(id: CookingActivity['id'], over: Partial<CookingActivity> = {}): CookingActivity {
  const d = defaultCookingActivities().find((a) => a.id === id)!;
  return { ...d, ...over };
}

describe('planificación de cocción', () => {
  it('desayuno, almuerzo y comida son actividades independientes', () => {
    const plan = planCooking(
      base({
        activities: [activity('breakfast'), activity('lunch'), activity('dinner')],
        gridAvailable: new Array<boolean>(COUNT).fill(true),
      }),
    );
    expect(plan.placements.map((p) => p.activityId)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(new Set(plan.placements.map((p) => p.startIndex)).size).toBe(3);
  });

  it('la hora preferida de preparación es «servir» menos la duración del proceso', () => {
    const lunch = activity('lunch');
    expect(preferredPrepStartHour(lunch)).toBeCloseTo(12, 6);
    expect(preferredPrepStartHour(activity('breakfast'))).toBeCloseTo(6.5, 6);
  });

  it('cocinar con combustible alternativo no crea demanda eléctrica', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch')],
        // Ni red ni PV alcanzan: sólo queda batería o combustible.
        gridAvailable: new Array<boolean>(COUNT).fill(false),
        substitution: 'fuel-first',
        hasFuel: true,
      }),
    );
    expect(plan.placements[0].coveredByFuel).toBe(true);
    expect(plan.demandAddW.every((w) => w === 0)).toBe(true);
    expect(plan.avoidedDemandKwh).toBeCloseTo((900 * 1) / 1000, 6);
    expect(plan.mealsCoveredByFuel).toBe(1);
  });

  it('sin combustible alternativo la demanda eléctrica no desaparece', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch')],
        gridAvailable: new Array<boolean>(COUNT).fill(false),
        substitution: 'fuel-first',
        hasFuel: false,
      }),
    );
    expect(plan.placements[0].coveredByFuel).toBe(false);
    expect(plan.demandAddW.reduce((a, b) => a + b, 0)).toBeCloseTo(900 * 4, 6);
  });

  it('la cocción eléctrica funciona con PV suficiente aunque no haya red', () => {
    const pv = new Array<number>(COUNT).fill(0);
    for (let i = 44; i < 48; i += 1) pv[i] = 2500; // 11:00–12:00
    const plan = planCooking(
      base({
        activities: [activity('lunch', { windowStartHour: 10, windowEndHour: 12.75 })],
        pvAvailableAcW: pv,
        gridAvailable: new Array<boolean>(COUNT).fill(false),
        mode: 'flexible',
      }),
    );
    expect(plan.placements[0].coveredByFuel).toBe(false);
    // El modo flexible adelanta la preparación a la franja con PV (11:00).
    expect(plan.placements[0].startIndex).toBe(44);
    expect(plan.placements[0].electricalCoverage).toBe(1);
  });

  it('un inversor pequeño no puede cocinar eléctricamente: cae al combustible si existe', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch')],
        inverterAcLimitW: 600,
        batteryAcLimitW: 600,
        gridAvailable: new Array<boolean>(COUNT).fill(false),
        substitution: 'electric-first',
        hasFuel: true,
      }),
    );
    expect(plan.placements[0].coveredByFuel).toBe(true);
    expect(plan.demandAddW.every((w) => w === 0)).toBe(true);
  });

  it('sin combustible y sin equipo capaz, la cocción se programa y fallará (se informa después)', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch')],
        inverterAcLimitW: 600,
        batteryAcLimitW: 600,
        gridAvailable: new Array<boolean>(COUNT).fill(false),
        hasFuel: false,
      }),
    );
    expect(plan.placements[0].coveredByFuel).toBe(false);
    expect(plan.demandAddW.some((w) => w > 0)).toBe(true);
  });

  it('la preparación flexible nunca sale de la ventana aceptable', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch', { windowStartHour: 9, windowEndHour: 11 })],
        mode: 'flexible',
        gridAvailable: (() => {
          const grid = new Array<boolean>(COUNT).fill(false);
          for (let i = 40; i < 44; i += 1) grid[i] = true; // 10:00–11:00
          return grid;
        })(),
      }),
    );
    const placement = plan.placements[0];
    expect(placement.startIndex).toBeGreaterThanOrEqual(9 * 4);
    expect(placement.startIndex + placement.intervals).toBeLessThanOrEqual(11 * 4);
    expect(placement.coveredByFuel).toBe(false);
  });

  it('la preparación flexible aprovecha la red cuando existe una franja útil', () => {
    const grid = new Array<boolean>(COUNT).fill(false);
    for (let i = 36; i < 48; i += 1) grid[i] = true; // 09:00–12:00
    const plan = planCooking(
      base({
        activities: [activity('lunch')],
        mode: 'flexible',
        gridAvailable: grid,
        hasFuel: true,
        substitution: 'fuel-first',
      }),
    );
    // La ventana del almuerzo empieza a las 11:00, ya dentro de la red:
    // se cocina eléctrico al principio de la ventana, no con gas.
    expect(plan.placements[0].coveredByFuel).toBe(false);
    expect(plan.placements[0].startIndex).toBe(44);
  });

  it('el modo habitual cocina en la hora preferida aunque haya una franja mejor', () => {
    const grid = new Array<boolean>(COUNT).fill(false);
    for (let i = 36; i < 48; i += 1) grid[i] = true;
    const plan = planCooking(
      base({ activities: [activity('lunch')], mode: 'usual', gridAvailable: grid }),
    );
    expect(plan.placements[0].startIndex).toBe(48); // 12:00, hora preferida
  });

  it('la cocción flexible no se traslada a la madrugada si hay otra opción', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch', { windowStartHour: 1, windowEndHour: 12 })],
        mode: 'flexible',
        gridAvailable: (() => {
          const grid = new Array<boolean>(COUNT).fill(false);
          for (let i = 36; i < 48; i += 1) grid[i] = true;
          return grid;
        })(),
      }),
    );
    expect(plan.placements[0].startIndex * 0.25).toBeGreaterThanOrEqual(9);
  });

  it('una actividad desactivada no añade demanda', () => {
    const plan = planCooking(
      base({ activities: [activity('lunch', { enabled: false })], gridAvailable: new Array<boolean>(COUNT).fill(true), hasFuel: true }),
    );
    expect(plan.placements).toHaveLength(0);
    expect(plan.demandAddW.every((w) => w === 0)).toBe(true);
  });

  it('sin combustible alternativo una comida no puede desactivarse para quitar su demanda', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch', { enabled: false })],
        gridAvailable: new Array<boolean>(COUNT).fill(true),
        hasFuel: false,
      }),
    );
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0].coveredByFuel).toBe(false);
    expect(plan.demandAddW.some((watts) => watts > 0)).toBe(true);
  });

  it('la ventana demasiado corta para el proceso descarta la actividad en lugar de partirlo', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch', { windowStartHour: 12, windowEndHour: 12.25, durationMinutes: 60 })],
        gridAvailable: new Array<boolean>(COUNT).fill(true),
        hasFuel: true,
      }),
    );
    expect(plan.placements).toHaveLength(0);
  });

  it('sin combustible la comida se mantiene aunque la ventana elegida sea demasiado corta', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch', { windowStartHour: 12, windowEndHour: 12.25, durationMinutes: 60 })],
        gridAvailable: new Array<boolean>(COUNT).fill(false),
        hasFuel: false,
      }),
    );
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0].intervals).toBe(4);
    expect(plan.demandAddW.some((watts) => watts > 0)).toBe(true);
  });

  it('la política «never» cocina eléctrico aunque haga falta tocar la batería', () => {
    const plan = planCooking(
      base({
        activities: [activity('lunch')],
        gridAvailable: new Array<boolean>(COUNT).fill(false),
        substitution: 'never',
        hasFuel: true,
      }),
    );
    expect(plan.placements[0].coveredByFuel).toBe(false);
    expect(plan.placements[0].electricalCoverage).toBe(0);
    expect(plan.demandAddW.some((w) => w > 0)).toBe(true);
  });
});