import { describe, expect, it } from 'vitest';
import { checkBalancedArrayConfiguration, checkStringDesign, irradianceAt, pvDcPowerAt, usablePvLimitW } from './pv';
import { inverter, panel, params, battery } from '../../test/fixtures';
import { inverterWithParallelUnits } from './inverter';
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


  it('encuentra una distribución uniforme de strings y equilibra los MPPT', () => {
    const check = checkBalancedArrayConfiguration(
      panel(),
      inverter({
        maxPvInputW: 8000,
        mppt: [
          { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 40, maxPowerW: 6000 },
          { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 40, maxPowerW: 6000 },
        ],
      }),
      12,
      params(),
    );
    expect(check.status).toBe('verified');
    expect(check.panelsPerString * check.totalStrings).toBe(12);
    expect(check.stringsPerMppt).toEqual([2, 2]);
  });

  it('permite usar sólo los MPPT que admiten la misma serie', () => {
    const check = checkBalancedArrayConfiguration(
      panel(),
      inverter({
        maxPvInputW: 8000,
        mppt: [
          { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 40, maxPowerW: 6000 },
          { maxVoltageV: 300, minVoltageV: 180, maxCurrentA: 40, maxPowerW: 6000 },
        ],
      }),
      6,
      params(),
    );
    expect(check.status).toBe('verified');
    expect(check.stringsPerMppt[0]).toBeGreaterThan(0);
    expect(check.stringsPerMppt[1]).toBe(0);
  });

  it('no declara incompatible si un MPPT incompleto podría admitir los strings restantes', () => {
    const check = checkBalancedArrayConfiguration(
      panel(),
      inverter({
        maxPvInputW: 8000,
        mppt: [
          { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 16, maxPowerW: 1800 },
          { maxVoltageV: 0, minVoltageV: 0, maxCurrentA: 0, maxPowerW: 0 },
        ],
      }),
      6,
      params(),
    );
    expect(check.status).toBe('insufficient');
    expect(check.feasible).toBe(false);
  });

  it('reparte cinco strings de forma equilibrada entre tres MPPT', () => {
    const check = checkBalancedArrayConfiguration(
      panel(),
      inverter({
        maxPvInputW: 10000,
        mppt: [0, 1, 2].map(() => ({ maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 40, maxPowerW: 6000 })),
      }),
      15,
      params(),
    );
    expect(check.status).toBe('verified');
    expect(check.panelsPerString * check.totalStrings).toBe(15);
    expect(check.stringsPerMppt).toEqual([2, 2, 1]);
  });

  it('mantiene el dimensionamiento energético con el límite PV anunciado si faltan datos MPPT', () => {
    const model = inverter({ maxPvInputW: 7200, maxPvVoltageV: 0, mppt: [] });
    expect(usablePvLimitW(model, panel(), params())).toBe(7200);
  });

  it('limita el dimensionamiento cuando los MPPT documentados no admiten más strings', () => {
    const model = inverter({
      maxPvInputW: 9000,
      maxPvVoltageV: 450,
      mppt: [
        { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 22, maxPowerW: 3000 },
        { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 22, maxPowerW: 3000 },
      ],
    });
    const limit = usablePvLimitW(model, panel(), params());
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(6000);
  });

  it('no inventa límites MPPT cuando faltan y deja la comprobación pendiente', () => {
    const check = checkBalancedArrayConfiguration(
      panel(),
      inverter({ mppt: [], maxPvVoltageV: 0 }),
      6,
      params(),
    );
    expect(check.status).toBe('insufficient');
    expect(check.feasible).toBe(false);
  });


  it('comprueba un banco de 16 inversores (32 MPPT) sin enumerar subconjuntos', () => {
    const single = inverter({
      maxPvInputW: 10000,
      maxParallelUnits: 16,
      mppt: [
        { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 40, maxPowerW: 6000 },
        { maxVoltageV: 450, minVoltageV: 80, maxCurrentA: 40, maxPowerW: 6000 },
      ],
    });
    const bank = inverterWithParallelUnits(single, 16);
    const check = checkBalancedArrayConfiguration(panel(), bank, 48, params());
    expect(bank.mppt).toHaveLength(32);
    expect(check.status).toBe('verified');
    expect(check.panelsPerString * check.totalStrings).toBe(48);
    expect(check.stringsPerMppt.reduce((sum, count) => sum + count, 0)).toBe(check.totalStrings);
  });

  it('la plantilla de batería declara su carácter orientativo', () => {
    expect(battery().isReference).toBe(true);
  });
});
