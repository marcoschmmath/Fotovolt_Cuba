import { describe, expect, it } from 'vitest';
import { checkStringDesign, irradianceAt, pvDcPowerAt, usablePvLimitW } from './pv';
import { inverter, panel, params, battery } from '../../test/fixtures';
import { solarFromParams } from '../core/defaults';

describe('modelo fotovoltaico', () => {
  it('la irradiancia integrada equivale a las horas solares pico', () => {
    const solar = solarFromParams(params({ hsp: 4.5 }));
    let sum = 0;
    for (let i = 0; i < 96; i += 1) {
      sum += irradianceAt((i + 0.5) * 0.25, solar) * 0.25;
    }
    expect(sum / 1000).toBeCloseTo(4.5, 1);
  });

  it('no produce energía fuera del intervalo diurno', () => {
    const solar = solarFromParams(params());
    expect(irradianceAt(2, solar)).toBe(0);
    expect(pvDcPowerAt(23, 2000, solar)).toBe(0);
  });

  it('la potencia DC nunca supera la instalada', () => {
    const solar = solarFromParams(params({ hsp: 6, tiltFactor: 1, shading: 0 }));
    let max = 0;
    for (let i = 0; i < 96; i += 1) {
      max = Math.max(max, pvDcPowerAt((i + 0.5) * 0.25, 2000, solar));
    }
    expect(max).toBeLessThanOrEqual(2000.001);
  });

  it('calcula una ventana de serie viable y respeta el límite de tensión', () => {
    const p = params();
    const check = checkStringDesign(panel(), inverter(), p);
    expect(check.minSeries).toBeGreaterThan(0);
    expect(check.maxSeries).toBeGreaterThanOrEqual(check.minSeries);
    expect(check.vocColdV).toBeGreaterThan(panel().vocV);
    expect(check.feasible).toBe(true);
  });

  it('rechaza un MPPT cuya tensión máxima es inferior a Voc en frío', () => {
    const check = checkStringDesign(
      panel(),
      inverter({ maxPvVoltageV: 40, mppt: [{ maxVoltageV: 40, minVoltageV: 10, maxCurrentA: 20, maxPowerW: 4000 }] }),
      params(),
    );
    expect(check.feasible).toBe(false);
    expect(check.maxSeries).toBe(0);
    expect(check.violations.length).toBeGreaterThan(0);
  });

  it('la potencia PV utilizable está limitada por el inversor', () => {
    const p = params();
    const small = inverter({ maxPvInputW: 3000 });
    expect(usablePvLimitW(small, panel(), p)).toBeLessThanOrEqual(3000);
    const limit = usablePvLimitW(inverter(), panel(), p);
    expect(limit).toBeGreaterThan(0);
    expect(Number.isFinite(limit)).toBe(true);
  });

  it('la plantilla de batería declara su carácter orientativo', () => {
    expect(battery().isReference).toBe(true);
  });
});
