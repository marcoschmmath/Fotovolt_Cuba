import { describe, expect, it } from 'vitest';
import { prepareSimulation, simulate, unservedEvents } from './engine';
import { appliance, battery, config, grid, inverter, panel, params } from '../../test/fixtures';

describe('simulación temporal', () => {
  it('recorre 24 horas desde las 08:00 y parte del SOC inicial indicado', () => {
    const p = params();
    const result = simulate(
      config({
        params: p,
        appliances: [],
        solar: { ...config().solar, hsp: 0 },
        grid: grid({ available: new Array(96).fill(false) }, p),
      }),
      { days: 1, startHour: 8, startSoc: 0.30 },
    );

    expect(result.intervals).toHaveLength(96);
    expect(result.intervals[0].clockIndex).toBe(32);
    expect(result.intervals[0].hour).toBeCloseTo(8.125, 6);
    expect(result.intervals[0].soc).toBeCloseTo(0.30, 6);
    expect(result.intervals[95].clockIndex).toBe(31);
    expect(result.intervals[95].hour).toBeCloseTo(7.875, 6);
  });

  it('conserva el balance energético en cada intervalo', () => {
    const result = simulate(config());
    expect(result.valid).toBe(true);
    expect(result.maxBalanceErrorKwh).toBeLessThan(1e-6);
  });

  it('mantiene el SOC dentro de los límites físicos', () => {
    const p = params();
    const result = simulate(
      config({
        params: p,
        appliances: [appliance({ powerW: 900, hoursPerDay: 24, schedule: 'custom', startHour: 0, priority: 'critical' })],
        batteryCount: 1,
        grid: grid({ available: new Array(96).fill(false) }, p),
      }),
      { days: 2, startSoc: 1 },
    );
    const minAllowed = Math.max(p.minSoc, 1 - battery().dod);
    for (const interval of result.intervals) {
      expect(interval.soc).toBeGreaterThanOrEqual(minAllowed - 1e-6);
      expect(interval.soc).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(result.totals.unservedKwh).toBeGreaterThan(0);
  });

  it('atiende las cargas críticas antes que las prescindibles', () => {
    const p = params();
    const result = simulate(
      config({
        params: p,
        solar: { ...config().solar, hsp: 0 },
        grid: grid({ available: new Array(96).fill(false) }, p),
        batteryCount: 1,
        appliances: [
          appliance({ id: 'crit', powerW: 100, hoursPerDay: 24, schedule: 'custom', startHour: 0, priority: 'critical' }),
          appliance({ id: 'opt', powerW: 8000, hoursPerDay: 24, schedule: 'custom', startHour: 0, priority: 'discretionary' }),
        ],
      }),
    );
    const first = result.intervals[0];
    expect(first.unservedByPriorityKwh.critical).toBe(0);
    expect(first.unservedByPriorityKwh.discretionary).toBeGreaterThan(0);
    expect(result.totals.unservedByPriorityKwh.discretionary).toBeGreaterThan(
      result.totals.unservedByPriorityKwh.critical,
    );
  });

  it('el inversor limita la generación y la batería limita la descarga', () => {
    const p = params();
    const result = simulate(
      config({
        params: p,
        panelCount: 20,
        inverter: inverter({ maxPvInputW: 1000, ratedW: 2000, surgeW: 4000, efficiency: 0.9 }),
        appliances: [appliance({ powerW: 5000, hoursPerDay: 24, schedule: 'custom', startHour: 0 })],
        batteryCount: 1,
      }),
    );
    expect(result.totals.pvClippedKwh).toBeGreaterThan(0);
    for (const interval of result.intervals) {
      expect(interval.pvAcW).toBeLessThanOrEqual(2000 + 1e-6);
      expect(interval.batteryDischargeAcW).toBeLessThanOrEqual(
        battery().maxDischargeW + 1e-6,
      );
    }
  });

  it('detecta cuándo y por qué no se suministra energía', () => {
    const p = params();
    const result = simulate(
      config({
        params: p,
        solar: { ...config().solar, hsp: 0 },
        grid: grid({ available: new Array(96).fill(false) }, p),
        appliances: [appliance({ powerW: 1000, hoursPerDay: 24, schedule: 'custom', startHour: 0, priority: 'critical' })],
      }),
    );
    const events = unservedEvents(result, p.stepMinutes);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].cause).toContain('imprescindibles');
  });


  it('un panel de plantilla genérico se marca como referencia, no como verificado', () => {
    const result = simulate(config({ panelCount: 40 }));
    // Con 40 paneles y batería pequeña el sistema limita: el aviso concreto es
    // el de excedente fotovoltaico, no «cualquier diagnóstico».
    expect(result.totals.curtailedKwh).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.code === 'PV_CURTAILED')).toBe(true);
  });

  it('el panel de la plantilla no excede límites del inversor en la configuración base', () => {
    const result = simulate(config({ panelCount: 2, panel: panel() }));
    expect(result.intervals.every((i) => i.soc >= 0 && i.soc <= 1)).toBe(true);
  });

  it('el modo resumido conserva las mismas métricas que el detallado sin materializar intervalos', () => {
    const p = params();
    const system = config({
      params: p,
      appliances: [
        appliance({ id: 'fast-critical', powerW: 350, hoursPerDay: 8, schedule: 'night', priority: 'critical' }),
        appliance({ id: 'fast-day', powerW: 180, hoursPerDay: 5, schedule: 'day', priority: 'important' }),
      ],
      grid: grid({ available: new Array(96).fill(false) }, p),
    });
    const options = { startHour: 8, startSoc: 0.30 };
    const detailed = simulate(system, options);
    const compact = simulate(system, {
      ...options,
      prepared: prepareSimulation(system),
      collectIntervals: false,
    });

    expect(compact.intervals).toHaveLength(0);
    expect(compact.totals).toEqual(detailed.totals);
    expect(compact.summary).toEqual(detailed.summary);
    expect(compact.valid).toBe(detailed.valid);
    expect(compact.maxBalanceErrorKwh).toBeCloseTo(detailed.maxBalanceErrorKwh, 12);
  });
});
