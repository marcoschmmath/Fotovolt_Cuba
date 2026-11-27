import { describe, expect, it } from 'vitest';
import { simulate } from './engine';
import { gridReturnScenarios, blackoutScenario } from './gridScenarios';
import { DEFAULT_PARAMS } from '../core/defaults';
import { defaultCookingActivities } from '../household/types';
import { appliance, battery, config, inverter, panel } from '../../test/fixtures';
import type { EnergySystemConfig, GridModel } from '../core/types';

/**
 * Política de despacho y reserva nocturna del nuevo modelo (§6, §7, §9).
 * Se comprueba el comportamiento físico, no la intención.
 */

const COUNT = 96;

/** Red disponible todo el día, con límite de importación amplio. */
function gridAlwaysOn(overrides: Partial<GridModel> = {}): GridModel {
  return {
    available: new Array<boolean>(COUNT).fill(true),
    maxPowerW: 30000,
    voltage: 'both',
    ...overrides,
  };
}

function householdSystem(overrides: Partial<EnergySystemConfig> = {}): EnergySystemConfig {
  return config({
    panelCount: 0,
    appliances: [appliance({ id: 'carga', name: 'Carga', powerW: 500, hoursPerDay: 24, schedule: 'both', priority: 'important' })],
    battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 5, dod: 0.8 }),
    inverter: inverter({ maxDischargeA: 40, maxChargeA: 40, batteryVoltageV: 48 }),
    grid: gridAlwaysOn(),
    ...overrides,
  });
}

describe('límites del inversor sobre la descarga (auditoría independiente)', () => {
  it('la batería no puede entregar más potencia AC que la nominal del inversor', () => {
    // Batería grande (5 kW) con inversor de sólo 1 kW y sin red: el inversor
    // manda, no el banco. Antes se entregaban 3 kW con un inversor de 1 kW.
    const configuration = householdSystem({
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }),
      panelCount: 0,
      inverter: inverter({ ratedW: 1000, surgeW: 2000, maxDischargeA: 100, maxChargeA: 100, batteryVoltageV: 48 }),
      appliances: [
        appliance({ id: 'carga', name: 'Carga', powerW: 3000, hoursPerDay: 24, schedule: 'both', priority: 'critical' }),
      ],
    });
    const result = simulate(configuration, { days: 1 });
    for (const interval of result.intervals) {
      expect(interval.batteryDischargeAcW).toBeLessThanOrEqual(1000 + 1e-6);
    }
    // La parte que el inversor no puede entregar queda sin servicio y se dice.
    expect(result.totals.unservedByPriorityKwh.critical).toBeGreaterThan(0);
  });

  it('la fracción solar nunca supera el 100 % de la demanda', () => {
    // Batería que se llena con sol y la red sirve la carga: la energía
    // almacenada y no entregada no puede contar como «fracción solar».
    const configuration = householdSystem({ panelCount: 40, batteryCount: 4 });
    const result = simulate(configuration, { days: 1 });
    expect(result.totals.solarFraction).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.totals.solarFraction).toBeGreaterThanOrEqual(0);
    expect(result.totals.pvToLoadKwh).toBeLessThanOrEqual(result.totals.demandKwh);
  });
});

describe('política híbrida (§7)', () => {
  it('con red disponible, la batería NO se descarga para la carga ordinaria', () => {
    const configuration = householdSystem();
    const result = simulate(configuration, { days: 1 });
    // La red sirve la carga: la batería se conserva para los apagones.
    expect(result.totals.batteryDischargeKwh).toBe(0);
    expect(result.totals.gridKwh).toBeGreaterThan(0);
    expect(result.totals.unservedKwh).toBe(0);
    expect(result.intervals.every((i) => i.batteryDrawnDcW === 0)).toBe(true);
  });

  it('sin red, la batería sirve la carga dentro de sus límites', () => {
    const configuration = householdSystem({
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }),
      battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 20, dod: 0.8 }),
    });
    const result = simulate(configuration, { days: 1 });
    expect(result.totals.batteryDischargeKwh).toBeGreaterThan(0);
    expect(result.totals.unservedKwh).toBe(0);
  });

  it('la importación de red nunca supera el límite declarado', () => {
    const configuration = householdSystem({
      grid: gridAlwaysOn({ maxPowerW: 600 }),
      appliances: [appliance({ id: 'carga', name: 'Carga', powerW: 5000, hoursPerDay: 24, schedule: 'both' })],
    });
    const result = simulate(configuration, { days: 1 });
    for (const interval of result.intervals) {
      expect(interval.gridW).toBeLessThanOrEqual(600 + 1e-6);
    }
  });

  it('un inversor sin cargador AC declarado no carga la batería desde la red', () => {
    const configuration = householdSystem({
      inverter: inverter({ maxDischargeA: 40, maxChargeA: 0, batteryVoltageV: 48 }),
    });
    const result = simulate(configuration, { days: 1 });
    expect(result.totals.batteryChargeKwh).toBe(0);
    expect(result.intervals.every((i) => i.batteryChargeGridW === 0)).toBe(true);
  });

  it('un inversor con cargador AC declarado recarga la batería desde la red', () => {
    const configuration = householdSystem({
      inverter: inverter({ maxDischargeA: 40, maxChargeA: 40, batteryVoltageV: 48, gridChargerW: 1000 }),
    });
    const result = simulate(configuration, { days: 1, startSoc: 0.2 });
    expect(result.totals.batteryChargeKwh).toBeGreaterThan(0);
    expect(result.intervals.some((i) => i.batteryChargeGridW > 0)).toBe(true);
  });
});

describe('sin exportación de red (§9)', () => {
  it('el excedente PV con red disponible se vierte, nunca se exporta', () => {
    const configuration = householdSystem({
      panelCount: 40,
      battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 0.1, dod: 0.8 }),
    });
    const result = simulate(configuration, { days: 1 });
    expect(result.totals.curtailedKwh).toBeGreaterThan(0);
    expect('exportedKwh' in result.totals).toBe(false);
    expect(result.intervals.every((i) => !('exportedW' in i))).toBe(true);
  });
});

describe('reserva nocturna (§6)', () => {
  /** Suelo de día = reserva; de noche = suelo mínimo del banco. */
  function floorArray(bankMinSoc: number, reserveSoc: number) {
    return Array.from({ length: COUNT }, (_, index) => {
      const hour = (index + 0.5) * 0.25;
      const isNight = hour >= 19 || hour < 7;
      return isNight ? bankMinSoc : reserveSoc;
    });
  }

  it('de día la batería no baja de la reserva nocturna', () => {
    // Carga sólo de día (07:00–19:00): al amanecer la batería está llena y el
    // día no puede comerse la energía que la noche necesita.
    const configuration = householdSystem({
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }),
      panelCount: 0,
      appliances: [
        appliance({ id: 'carga', name: 'Carga', powerW: 500, hoursPerDay: 12, schedule: 'day', priority: 'important' }),
      ],
    });
    const reserve = floorArray(0.2, 0.5);
    const result = simulate(configuration, { days: 1, startSoc: 1, socFloorByInterval: reserve });
    for (const interval of result.intervals) {
      const isDay = interval.hour >= 7 && interval.hour < 19;
      if (isDay) expect(interval.soc).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
    // La carga diaria no cabe en la mitad «libre»: el resto queda sin servicio
    // en lugar de robar la reserva.
    expect(result.totals.unservedKwh).toBeGreaterThan(0);
  });

  it('de noche puede usar la energía reservada hasta el suelo del banco', () => {
    const configuration = householdSystem({
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }),
      appliances: [appliance({ id: 'noche', name: 'Ventilador', powerW: 500, hoursPerDay: 24, schedule: 'night', priority: 'critical' })],
    });
    const reserve = floorArray(0.2, 0.5);
    const result = simulate(configuration, { days: 1, startSoc: 0.5, socFloorByInterval: reserve });
    const night = result.intervals.filter((i) => i.hour >= 19 || i.hour < 7);
    expect(night.some((i) => i.soc < 0.5 - 1e-6)).toBe(true);
    // Nunca por debajo del suelo del banco.
    expect(result.totals.minSoc).toBeGreaterThanOrEqual(0.2 - 1e-6);
  });

  it('sin combustible la comida puede consumir la reserva nocturna hasta el mínimo físico', () => {
    const configuration = householdSystem({
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }),
      panelCount: 0,
      appliances: [],
      battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 5, dod: 0.8 }),
    });
    const lunch = {
      ...defaultCookingActivities().find((activity) => activity.id === 'lunch')!,
      mealHour: 13,
      windowStartHour: 12,
      windowEndHour: 14,
      powerW: 900,
      durationMinutes: 60,
    };
    const reserve = new Array<number>(COUNT).fill(0.6);
    const result = simulate(configuration, {
      days: 1,
      startHour: 8,
      startSoc: 0.5,
      socFloorByInterval: reserve,
      cooking: { activities: [lunch], mode: 'usual', substitution: 'fuel-first', hasFuel: false },
    });

    const cookingIntervals = result.intervals.filter((interval) =>
      interval.activeLoads.some((load) => load.kind === 'cooking' && load.name === lunch.label),
    );
    expect(cookingIntervals).toHaveLength(4);
    expect(cookingIntervals.every((interval) => interval.unservedW === 0)).toBe(true);
    expect(cookingIntervals[0].soc).toBeLessThan(0.5);
    expect(result.totals.cookingMealsUnmet).toBe(0);
    // La reserva configurada era 60 %, pero la comida puede usarla hasta el mínimo físico (20 %).
    expect(result.totals.minSoc).toBeGreaterThanOrEqual(0.2 - 1e-6);
  });
});

describe('cocción dentro del motor (§5)', () => {
  const activities = defaultCookingActivities();

  it('la cocción esencial queda sin cobertura y se informa cuando no hay electricidad ni gas', () => {
    const configuration = householdSystem({ grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }), panelCount: 0 });
    const result = simulate(configuration, {
      days: 1,
      cooking: { activities, mode: 'usual', substitution: 'never', hasFuel: false },
    });
    expect(result.cooking?.placements.length).toBe(3);
    expect(result.totals.cookingMealsUnmet).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.code === 'COOKING_UNMET')).toBe(true);
  });

  it('con combustible alternativo la comida se cubre sin demanda eléctrica', () => {
    const configuration = householdSystem({ grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }), panelCount: 0 });
    const result = simulate(configuration, {
      days: 1,
      cooking: { activities, mode: 'usual', substitution: 'fuel-first', hasFuel: true },
    });
    expect(result.totals.cookingMealsSubstituted).toBe(3);
    expect(result.totals.cookingEnergyAvoidedKwh).toBeCloseTo((500 * 0.5 + 900 * 1 + 900 * 1) / 1000, 6);
    expect(result.totals.cookingMealsUnmet).toBe(0);
  });

  it('la cocción se programa aunque no haya red: el motor decide si se sirve', () => {
    const configuration = householdSystem({
      panelCount: 40,
      battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 20, dod: 0.8 }),
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(true) }),
    });
    const result = simulate(configuration, {
      days: 1,
      cooking: { activities, mode: 'usual', substitution: 'never', hasFuel: false },
    });
    // Con red y batería grandes, la cocción se sirve y no falta nada.
    expect(result.totals.cookingMealsUnmet).toBe(0);
    expect(result.cooking?.placements.every((p) => !p.coveredByFuel)).toBe(true);
  });

  it('un inversor demasiado pequeño no puede cocinar eléctricamente', () => {
    const configuration = householdSystem({
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }),
      panelCount: 40,
      inverter: inverter({ ratedW: 400, surgeW: 800, maxDischargeA: 20, maxChargeA: 20, batteryVoltageV: 48 }),
    });
    const result = simulate(configuration, {
      days: 1,
      cooking: { activities, mode: 'usual', substitution: 'never', hasFuel: false },
    });
    expect(result.totals.cookingMealsUnmet).toBeGreaterThan(0);
  });
});

describe('escenarios idénticos para todas las instalaciones (§4)', () => {
  it('dos instalaciones distintas usan exactamente el mismo conjunto', () => {
    const a = gridReturnScenarios(DEFAULT_PARAMS);
    const b = gridReturnScenarios(DEFAULT_PARAMS);
    expect(a).toEqual(b);
  });

  it('el apagón total no tiene ningún intervalo con red', () => {
    const blackout = blackoutScenario(DEFAULT_PARAMS);
    const configuration = householdSystem({ grid: { available: blackout.available, maxPowerW: 30000, voltage: 'both' } });
    const result = simulate(configuration, { days: 1 });
    expect(result.totals.gridKwh).toBe(0);
    expect(result.intervals.every((i) => i.gridW === 0)).toBe(true);
  });
});

describe('características del equipo ofertado', () => {
  it('una batería sin potencia declarada no permite descarga infinita', () => {
    const configuration = householdSystem({
      grid: gridAlwaysOn({ available: new Array<boolean>(COUNT).fill(false) }),
      battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 5, dod: 0.8 }),
    });
    const result = simulate(configuration, { days: 1 });
    for (const interval of result.intervals) {
      expect(interval.batteryDrawnDcW).toBeLessThanOrEqual(1920 + 1e-6);
    }
  });

  it('un panel sin datos eléctricos sigue simulando energía', () => {
    const configuration = householdSystem({
      panelCount: 4,
      panel: panel({ vocV: 0, vmppV: 0, iscA: 0, imppA: 0, powerW: 550 }),
    });
    const result = simulate(configuration, { days: 1 });
    expect(result.valid).toBe(true);
    expect(result.totals.pvProducedKwh).toBeGreaterThan(0);
  });
});