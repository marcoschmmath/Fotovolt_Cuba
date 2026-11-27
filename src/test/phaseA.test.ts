import { describe, expect, it } from 'vitest';
import { simulate } from '../domain/simulator/engine';
import { checkStringDesign, usablePvLimitW } from '../domain/calculator/pv';
import {
  autonomyHours,
  batteryPack,
  dailyRechargeKwh,
  effectiveMinSoc,
  requiredBatteryNominalKwh,
} from '../domain/calculator/battery';
import { analyzeEnergy } from '../domain/calculator/energy';
import { computeSizing } from '../domain/calculator/sizing';
import { appliance, battery, config, grid, inverter, panel, params } from './fixtures';
import { solarFromParams } from '../domain/core/defaults';

/**
 * Regresión de la Fase A (INFORME-REVISION C1–C8 / FIX-PLAN A1–A8).
 * Cada test debe FALLAR si se revierte el arreglo correspondiente.
 */

describe('A1 — un único presupuesto de descarga compartido (C1)', () => {
  const p = params();
  const base = config({
    params: p,
    solar: { ...solarFromParams(p), hsp: 0 },
    grid: grid({ available: new Array(96).fill(false) }, p),
    battery: battery({ maxDischargeW: 1000 }),
    batteryCount: 1,
    appliances: [
      appliance({ id: 'crit', powerW: 800, hoursPerDay: 24, schedule: 'custom', startHour: 0, priority: 'critical' }),
      appliance({ id: 'opt', powerW: 800, hoursPerDay: 24, schedule: 'custom', startHour: 0, priority: 'discretionary' }),
    ],
  });

  it('las prioridades no pueden extraer cada una el presupuesto completo', () => {
    const result = simulate(base, { startSoc: 1 });
    const limit = Math.min(
      battery({ maxDischargeW: 1000 }).maxDischargeW,
      inverter().maxDischargeA * battery().nominalV,
    );
    for (const interval of result.intervals) {
      expect(interval.batteryDrawnDcW).toBeLessThanOrEqual(limit + 1e-6);
    }
    // Y efectivamente se llega al tope: sin el reparto compartido la suma de
    // prioridades lo superaría.
    const maxDrawn = Math.max(...result.intervals.map((i) => i.batteryDrawnDcW));
    expect(maxDrawn).toBeGreaterThan(limit * 0.9);
  });

  it('la energía servida por prioridad es consistente con la servida total', () => {
    const result = simulate(base, { startSoc: 1 });
    for (const interval of result.intervals) {
      const sum =
        interval.servedByPriorityKwh.critical +
        interval.servedByPriorityKwh.important +
        interval.servedByPriorityKwh.discretionary;
      expect(sum).toBeCloseTo(interval.servedW * (p.stepMinutes / 60 / 1000), 9);
    }
  });
});

describe('A2 — un único presupuesto de carga compartido (C2)', () => {
  const p = params();
  const base = config({
    params: p,
    panelCount: 30,
    battery: battery({ maxChargeW: 800 }),
    batteryCount: 1,
    grid: grid(
      { available: new Array(96).fill(true), maxPowerW: 10000 },
      p,
    ),
    appliances: [appliance({ powerW: 300, hoursPerDay: 24, schedule: 'custom', startHour: 0 })],
  });

  it('PV y red juntos nunca superan maxChargeW en el mismo intervalo', () => {
    const result = simulate(base, { startSoc: 0.2 });
    const limit = Math.min(
      battery({ maxChargeW: 800 }).maxChargeW,
      inverter().maxChargeA * battery().nominalV,
    );
    for (const interval of result.intervals) {
      expect(interval.batteryChargeW).toBeLessThanOrEqual(limit + 1e-6);
      // La ruta por red también respeta el límite del BMS (antes lo omitía).
      expect(interval.batteryChargeGridW).toBeLessThanOrEqual(limit + 1e-6);
      expect(interval.batteryChargePvW + interval.batteryChargeGridW).toBeCloseTo(
        interval.batteryChargeW,
        9,
      );
    }
    const maxCharge = Math.max(...result.intervals.map((i) => i.batteryChargeW));
    expect(maxCharge).toBeGreaterThan(limit * 0.9);
  });

  it('la importación de red no supera la potencia del cargador declarado', () => {
    const result = simulate(base, { startSoc: 0.2 });
    for (const interval of result.intervals) {
      expect(interval.gridChargeW).toBeLessThanOrEqual(5000 + 1e-6);
      expect(interval.gridW).toBeLessThanOrEqual(10000 + 1e-6);
    }
  });
});

describe('A3 — un solo DoD/SOC efectivo (C3)', () => {
  it('el dimensionamiento usa el DoD más restrictivo de params y batería', () => {
    const p = params({ dod: 1, minSoc: 0.1 });
    const b = battery({ dod: 0.8 });
    const energy = analyzeEnergy(
      [appliance({ powerW: 1000, hoursPerDay: 8, schedule: 'night' })],
      p,
    );
    // Con dod=1 en params el viejo código usaba 1 − minSoc = 0,9 de útil;
    // el DoD de fabricante (0,8) es más restrictivo → 0,2 de SOC mínimo.
    expect(effectiveMinSoc(p, b)).toBeCloseTo(0.2, 9);
    const required = requiredBatteryNominalKwh(energy, p, b);
    expect(required).toBeCloseTo((energy.nightKwh * p.autonomyDays) / (0.8 * 0.95 * 0.92), 6);
  });

  it('la simulación y el dimensionamiento comparten el mismo SOC mínimo', () => {
    const p = params({ dod: 1, minSoc: 0.1 });
    const b = battery({ dod: 0.8 });
    const pack = batteryPack(b, 2, p);
    // El suelo efectivo es el más restrictivo de los tres (0,2 del DoD).
    expect(pack.minSoc).toBeCloseTo(0.2, 9);
    // Invariante físico con valores conocidos: banco nominal 10 kWh, 80 %
    // utilizable (2 × 5 kWh de plantilla), no una relectura de la fórmula.
    expect(pack.nominalKwh).toBeCloseTo(10, 9);
    expect(pack.usableKwh).toBeCloseTo(8, 9);
    expect(pack.usableKwh).toBeLessThan(pack.nominalKwh);
  });
});

describe('A4 — la recarga diaria incluye la descarga (C4)', () => {
  it('pide reponer nightKwh/(η_descarga·η_inv·η_carga)', () => {
    const p = params();
    const energy = analyzeEnergy(
      [appliance({ powerW: 1000, hoursPerDay: 5, schedule: 'night' })],
      p,
    );
    expect(energy.nightKwh).toBeCloseTo(5, 6);
    expect(dailyRechargeKwh(energy, p, battery())).toBeCloseTo(5 / (0.95 * 0.92 * 0.95), 6);
    // Nunca menos que la energía retirada de la batería.
    expect(dailyRechargeKwh(energy, p, battery())).toBeGreaterThan(energy.nightKwh);
  });

  it('con carga solo diurna no pide recarga adicional', () => {
    const p = params();
    const energy = analyzeEnergy([appliance({ powerW: 1000, hoursPerDay: 5, schedule: 'day' })], p);
    expect(dailyRechargeKwh(energy, p, battery())).toBe(0);
  });
});

describe('A5 — una sola definición de autonomía (C5)', () => {
  it('sin carga crítica la autonomía es 0, no miles de horas', () => {
    const p = params();
    const pack = batteryPack(battery(), 4, p);
    expect(autonomyHours(pack, 0, p)).toBe(0);
    expect(autonomyHours(pack, -10, p)).toBe(0);

    const sizing = computeSizing({
      appliances: [appliance({ powerW: 500, hoursPerDay: 8, schedule: 'day', priority: 'discretionary' })],
      params: p,
      panel: panel(),
      battery: battery(),
      inverters: [inverter()],
      voltage: 'both',
      grid: grid({}, p),
      solar: solarFromParams(p),
    });
    expect(sizing.autonomyH).toBe(0);
  });

  it('crece con la capacidad y decrece con la carga crítica', () => {
    const p = params();
    const small = batteryPack(battery(), 1, p);
    const big = batteryPack(battery(), 3, p);
    expect(autonomyHours(big, 500, p)).toBeCloseTo(autonomyHours(small, 500, p) * 3, 6);
    expect(autonomyHours(small, 1000, p)).toBeLessThan(autonomyHours(small, 500, p));
  });
});

describe('A6 — datos PV inválidos no se verifican (C6)', () => {
  it('panel sin Voc → estado insufficient, no «Verificado»', () => {
    const check = checkStringDesign(panel({ vocV: 0 }), inverter(), params());
    expect(check.status).toBe('insufficient');
    expect(check.feasible).toBe(false);
    expect(check.notes.join(' ')).not.toContain('Infinity');
  });

  it('MPPT con límites no finitos → insufficient, no una ventana infinita', () => {
    const check = checkStringDesign(
      panel(),
      inverter({
        maxPvVoltageV: Number.POSITIVE_INFINITY,
        mppt: [
          {
            maxVoltageV: Number.POSITIVE_INFINITY,
            minVoltageV: 10,
            maxCurrentA: Number.POSITIVE_INFINITY,
            maxPowerW: Number.POSITIVE_INFINITY,
          },
        ],
      }),
      params(),
    );
    expect(check.status).toBe('insufficient');
    expect(check.feasible).toBe(false);
    expect(check.notes.join(' ')).not.toContain('Infinity');
  });
});

describe('A7 — strings inviables no proponen PV utilizable (C7/M15)', () => {
  it('ventana vacía → recommendedSeries fuera del rango imposible', () => {
    const check = checkStringDesign(
      panel(),
      inverter({
        maxPvVoltageV: 40,
        mppt: [{ maxVoltageV: 40, minVoltageV: 300, maxCurrentA: 20, maxPowerW: 4000 }],
      }),
      params(),
    );
    expect(check.feasible).toBe(false);
    // C7/M15: sin ventana factible NO se devuelve ninguna configuración.
    expect(check.recommendedSeries).toBe(0);
    expect(check.feasible).toBe(false);
  });

  it('usablePvLimitW es 0 cuando la comprobación no es factible', () => {
    const bad = inverter({
      maxPvVoltageV: 40,
      mppt: [{ maxVoltageV: 40, minVoltageV: 300, maxCurrentA: 20, maxPowerW: 4000 }],
    });
    expect(usablePvLimitW(bad, panel(), params())).toBe(0);
  });

  it('una configuración factible sí devuelve un límite positivo y finito', () => {
    const limit = usablePvLimitW(inverter(), panel(), params());
    expect(limit).toBeGreaterThan(0);
    expect(Number.isFinite(limit)).toBe(true);
  });
});

describe('A8 — sin cargas no se emite «ningún inversor compatible» (M17)', () => {
  it('devuelve vacío y sólo el aviso NO_LOADS', () => {
    const p = params();
    const sizing = computeSizing({
      appliances: [],
      params: p,
      panel: panel(),
      battery: battery(),
      inverters: [inverter()],
      voltage: 'both',
      grid: grid({}, p),
      solar: solarFromParams(p),
    });
    expect(sizing.config).toBeNull();
    expect(sizing.inverter).toBeNull();
    expect(sizing.panelCount).toBe(0);
    expect(sizing.diagnostics.map((d) => d.code)).toEqual(['NO_LOADS']);
    expect(sizing.inverterRejections).toEqual([]);
  });
});
