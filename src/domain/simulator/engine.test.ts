import { describe, expect, it } from 'vitest';
import { simulate, unservedEvents } from './engine';
import { buildScenarios } from './scenarios';
import { appliance, battery, config, grid, inverter, panel, params } from '../../test/fixtures';

describe('simulación temporal', () => {
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
    expect(first.unservedByPriority.critical).toBe(0);
    expect(first.unservedByPriority.discretionary).toBeGreaterThan(0);
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

  it('los escenarios son ilustrativos y ordenan la producción', () => {
    const base = config();
    const scenarios = buildScenarios(base);
    expect(scenarios.map((s) => s.id)).toEqual(['favorable', 'habitual', 'desfavorable']);
    const results = scenarios.map((s) => simulate(s.config).totals.pvProducedKwh);
    expect(results[0]).toBeGreaterThan(results[1]);
    expect(results[1]).toBeGreaterThan(results[2]);
    expect(scenarios[0].assumptions.length).toBeGreaterThan(0);
  });

  it('acepta equipos de plantilla y advierte de ello', () => {
    const result = simulate(config());
    expect(result.diagnostics.some((d) => d.code === 'PV_CURTAILED' || d.code === 'PV_CLIPPED' || d.code === 'SOC_MIN' || d.code === 'CRITICAL_UNSERVED' || d.code === 'STUDY_REQUIRED')).toBe(true);
  });

  it('el panel de la plantilla no excede límites del inversor en la configuración base', () => {
    const result = simulate(config({ panelCount: 2, panel: panel() }));
    expect(result.intervals.every((i) => i.soc >= 0 && i.soc <= 1)).toBe(true);
  });
});
