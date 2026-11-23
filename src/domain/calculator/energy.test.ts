import { describe, expect, it } from 'vitest';
import {
  analyzeEnergy,
  buildDailyDemand,
  dutyOnFraction,
  effectivePowerW,
  peakDesignW,
} from './energy';
import { appliance, params } from '../../test/fixtures';

describe('energía y perfiles de carga', () => {
  it('E_d = Σ(P·n·h)/1000 para un equipo diurno', () => {
    const p = params();
    const energy = analyzeEnergy([appliance({ powerW: 100, hoursPerDay: 5 })], p);
    expect(energy.dailyKwh).toBeCloseTo(0.5, 6);
    expect(energy.nightKwh).toBeCloseTo(0, 6);
    expect(energy.peakSimultaneousW).toBe(100);
  });

  it('clasifica la energía nocturna según la franja configurada', () => {
    const energy = analyzeEnergy(
      [appliance({ powerW: 200, hoursPerDay: 4, schedule: 'night' })],
      params(),
    );
    expect(energy.dailyKwh).toBeCloseTo(0.8, 6);
    expect(energy.nightKwh).toBeCloseTo(0.8, 6);
  });

  it('reparte el perfil "ambos" entre día y noche', () => {
    const energy = analyzeEnergy(
      [appliance({ powerW: 100, hoursPerDay: 6, schedule: 'both' })],
      params(),
    );
    expect(energy.dailyKwh).toBeCloseTo(0.6, 6);
    expect(energy.nightKwh).toBeGreaterThan(0);
    expect(energy.nightKwh).toBeLessThan(0.6);
  });

  it('el ciclo de trabajo conserva la energía media', () => {
    const p = params({ cyclicCycleMinutes: 20 });
    const energy = analyzeEnergy(
      [appliance({ powerW: 100, hoursPerDay: 2, dutyCycle: 0.5, profile: 'cyclic' })],
      p,
    );
    expect(energy.dailyKwh).toBeCloseTo(0.1, 6);
  });

  it('dutyOnFraction respeta los límites 0 y 1', () => {
    expect(dutyOnFraction(0, 0.25, 0, 0.25)).toBe(0);
    expect(dutyOnFraction(0, 0.25, 1, 0.25)).toBe(1);
    const value = dutyOnFraction(0, 0.25, 0.5, 0.25);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it('estima vatios desde BTU/h con el EER configurable y marca la estimación', () => {
    const p = params({ acEer: 10 });
    const a = appliance({ btuPerHour: 12000, powerW: 1200, powerIsEstimate: true });
    expect(effectivePowerW(a, p)).toBeCloseTo(1200, 6);
    const corrected = appliance({ btuPerHour: 12000, powerW: 900, powerIsEstimate: false });
    expect(effectivePowerW(corrected, p)).toBe(900);
  });

  it('el pico de diseño añade el arranque del motor más grande, no todos', () => {
    const energy = analyzeEnergy(
      [
        appliance({ id: 'a', powerW: 100, hoursPerDay: 3, surgeFactor: 4 }),
        appliance({ id: 'b', powerW: 200, hoursPerDay: 3, surgeFactor: 5 }),
      ],
      params(),
    );
    // simultánea 300 W + mayor incremento (200*4) = 1100 W
    expect(peakDesignW(energy)).toBeCloseTo(1100, 6);
  });

  it('la serie temporal y el resumen coinciden', () => {
    const p = params();
    const items = [appliance(), appliance({ id: 'a2', powerW: 50, hoursPerDay: 2, schedule: 'night', priority: 'important' })];
    const demand = buildDailyDemand(items, p);
    const energy = analyzeEnergy(items, p, demand);
    const summed = demand.reduce((sum, d) => sum + d.totalW * (p.stepMinutes / 60) / 1000, 0);
    expect(energy.dailyKwh).toBeCloseTo(summed, 9);
    expect(energy.byPriorityKwh.important).toBeCloseTo(0.1, 6);
  });
});
