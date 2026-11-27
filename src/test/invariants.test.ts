import { describe, expect, it } from 'vitest';
import { simulate } from '../domain/simulator/engine';
import { intervalCount, buildDailyDemand } from '../domain/calculator/energy';
import { PRIORITIES } from '../domain/calculator/energy';
import { batteryPack } from '../domain/calculator/battery';
import { appliance, battery, config, inverter, params, panel } from './fixtures';
import type { EnergySystemConfig } from '../domain/core/types';

/**
 * Invariantes físicos comprobados de forma INDEPENDIENTE al código que se
 * revisa: se recalculan a partir de las tensiones del equipo, no de la misma
 * expresión que usa el motor.
 */
const kwhPerWatt = (stepMinutes: number) => stepMinutes / 60 / 1000;

/** Configuración con las tres prioridades exigiendo más de lo que la batería da. */
function overloaded(overrides: Partial<EnergySystemConfig> = {}): EnergySystemConfig {
  const design = params({ stepMinutes: 15 });
  const base: EnergySystemConfig = {
    ...config({ params: design }),
    panelCount: 6,
    appliances: [
      appliance({ id: 'c1', name: 'Crítico', priority: 'critical', powerW: 2000, hoursPerDay: 24, schedule: 'both' }),
      appliance({ id: 'i1', name: 'Importante', priority: 'important', powerW: 2000, hoursPerDay: 24, schedule: 'both' }),
      appliance({ id: 'd1', name: 'Prescindible', priority: 'discretionary', powerW: 2000, hoursPerDay: 24, schedule: 'both' }),
    ],
    battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 5, dod: 0.8 }),
    inverter: inverter({ maxChargeA: 40, maxDischargeA: 40, batteryVoltageV: 48 }),
    ...overrides,
  };
  return base;
}

describe('invariantes del simulador', () => {
  it('respeta la potencia máxima de descarga en cada intervalo (C1)', () => {
    const configuration = overloaded();
    const pack = batteryPack(configuration.battery, configuration.batteryCount, configuration.params);
    const limitW = Math.min(
      pack.maxDischargeW,
      configuration.inverter.maxDischargeA * configuration.battery.nominalV,
    );
    const result = simulate(configuration, { days: 1 });
    for (const interval of result.intervals) {
      expect(interval.batteryDrawnDcW).toBeLessThanOrEqual(limitW + 1e-6);
    }
  });

  it('respeta la potencia máxima de carga combinada en cada intervalo (C2)', () => {
    const configuration = overloaded();
    const pack = batteryPack(configuration.battery, configuration.batteryCount, configuration.params);
    const limitW = Math.min(
      pack.maxChargeW,
      configuration.inverter.maxChargeA * configuration.battery.nominalV,
    );
    const result = simulate(configuration, { days: 1 });
    for (const interval of result.intervals) {
      expect(interval.batteryChargeW).toBeLessThanOrEqual(limitW + 1e-6);
    }
  });

  it('mantiene el SOC dentro del suelo y el techo durante varios días', () => {
    const configuration = overloaded({ panelCount: 0 });
    const pack = batteryPack(configuration.battery, configuration.batteryCount, configuration.params);
    const result = simulate(configuration, { days: 3 });
    expect(result.intervals).toHaveLength(intervalCount(configuration.params) * 3);
    for (const interval of result.intervals) {
      expect(interval.soc).toBeGreaterThanOrEqual(pack.minSoc - 1e-6);
      expect(interval.soc).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('cuenta como fallo una carga crítica pequeña (umbral de desprecio)', () => {
    // 15 W críticos toda la noche con 0 PV y sin red: se pierden 0,0375 kWh por
    // intervalo. El umbral de «no se ha servido» no puede ignorarlo.
    const configuration = overloaded({
      panelCount: 0,
      battery: battery({ maxDischargeW: 1920, maxChargeW: 1920, nominalKwh: 0.1, dod: 0.8 }),
      appliances: [
        appliance({ id: 'c1', name: 'Router', priority: 'critical', powerW: 15, hoursPerDay: 24, schedule: 'night' }),
      ],
    });
    const result = simulate(configuration, { days: 1 });
    expect(result.totals.unservedByPriorityKwh.critical).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.code === 'CRITICAL_UNSERVED')).toBe(true);
  });

  it('conserva el balance energético: servido + no servido = demanda', () => {
    const configuration = overloaded();
    const result = simulate(configuration, { days: 1 });
    const demand = buildDailyDemand(configuration.appliances, configuration.params).reduce(
      (sum, interval) => sum + interval.totalW * kwhPerWatt(configuration.params.stepMinutes),
      0,
    );
    expect(result.totals.servedKwh + result.totals.unservedKwh).toBeCloseTo(demand, 6);
    expect(result.valid).toBe(true);
  });

  it('discretiza el día exactamente en los pasos admitidos', () => {
    for (const stepMinutes of [5, 10, 15, 30, 60]) {
      const configuration = config({ params: params({ stepMinutes }) });
      const result = simulate(configuration, { days: 1 });
      expect(result.intervals).toHaveLength(intervalCount(configuration.params));
      expect(result.intervals[0].hour).toBeCloseTo(stepMinutes / 120, 6);
      expect(result.intervals[result.intervals.length - 1].hour).toBeCloseTo(24 - stepMinutes / 120, 6);
    }
  });

  it('la energía cargada en la batería coincide con la diferencia de SOC', () => {
    const configuration = overloaded();
    const pack = batteryPack(configuration.battery, configuration.batteryCount, configuration.params);
    const result = simulate(configuration, { days: 1, startSoc: pack.minSoc });
    const deltaKwh = (result.totals.finalSoc - pack.minSoc) * pack.nominalKwh;
    expect(result.totals.batteryChargeKwh - result.totals.batteryDischargeKwh).toBeCloseTo(deltaKwh, 6);
  });

  it('la demanda por prioridad suma exactamente la demanda total', () => {
    const configuration = overloaded();
    const result = simulate(configuration, { days: 1 });
    const byPriority = PRIORITIES.reduce(
      (sum, priority) =>
        sum + result.intervals.reduce((inner, interval) => inner + interval.servedByPriorityKwh[priority] + interval.unservedByPriorityKwh[priority], 0),
      0,
    );
    expect(byPriority).toBeCloseTo(result.totals.demandKwh, 6);
  });

  it('un array sin datos eléctricos no produce una ventana de serie infinita', () => {
    const configuration = overloaded();
    const brokenPanel = { ...panel(), vocV: 0, vmppV: 0, iscA: 0, imppA: 0, powerW: 550 };
    const result = simulate({ ...configuration, panel: brokenPanel, panelCount: 4 });
    // Sin datos no se puede afirmar que pase nada, pero el balance sigue siendo válido.
    expect(result.valid).toBe(true);
    expect(result.totals.pvProducedKwh).toBeGreaterThan(0);
  });
});