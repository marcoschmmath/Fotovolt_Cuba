import type { EnergySystemConfig, GridModel } from '../core/types';
import { intervalCount } from '../calculator/energy';

export type ScenarioId = 'favorable' | 'habitual' | 'desfavorable';

export interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
  assumptions: string[];
  config: EnergySystemConfig;
}

function adjustGridHours(grid: GridModel, params: DesignParamsLike, delta: number): GridModel {
  const count = intervalCount(params);
  const perHour = 60 / params.stepMinutes;
  const available = [...grid.available];
  let remaining = Math.abs(Math.round(delta * perHour));
  if (remaining === 0) return { ...grid, available };

  if (delta > 0) {
    // Añade el tiempo junto a la última franja conectada (hipótesis ilustrativa).
    let cursor = available.findIndex((on) => on);
    if (cursor < 0) cursor = Math.floor(count / 2);
    while (remaining > 0 && cursor < count) {
      if (!available[cursor]) {
        available[cursor] = true;
        remaining -= 1;
      }
      cursor += 1;
    }
  } else {
    for (let i = count - 1; i >= 0 && remaining > 0; i -= 1) {
      if (available[i]) {
        available[i] = false;
        remaining -= 1;
      }
    }
  }
  return { ...grid, available };
}

type DesignParamsLike = EnergySystemConfig['params'];

function clone(config: EnergySystemConfig): EnergySystemConfig {
  return {
    ...config,
    solar: { ...config.solar },
    params: { ...config.params },
    grid: { ...config.grid, available: [...config.grid.available] },
    appliances: config.appliances.map((a) => ({ ...a })),
  };
}

/**
 * Tres escenarios ilustrativos. No son probabilidades estadísticas ni
 * pronósticos: muestran cómo cambia el resultado al variar las hipótesis.
 */
export function buildScenarios(base: EnergySystemConfig): Scenario[] {
  const favorable = clone(base);
  favorable.solar = {
    ...favorable.solar,
    hsp: Math.min(7, favorable.solar.hsp * 1.15),
    ambientC: favorable.solar.ambientC - 3,
    shading: Math.max(0, favorable.solar.shading - 0.03),
  };
  favorable.grid = adjustGridHours(favorable.grid, favorable.params, 1);

  const unfavorable = clone(base);
  unfavorable.solar = {
    ...unfavorable.solar,
    hsp: Math.max(1.5, unfavorable.solar.hsp * 0.8),
    ambientC: unfavorable.solar.ambientC + 4,
    shading: Math.min(0.35, unfavorable.solar.shading + 0.08),
  };
  unfavorable.grid = adjustGridHours(unfavorable.grid, unfavorable.params, -1);

  return [
    {
      id: 'favorable',
      label: 'Favorable',
      description: 'Más sol, menos sombras y algo más de red de lo previsto.',
      assumptions: [
        `HSP ${favorable.solar.hsp.toFixed(2)} h (base ${base.solar.hsp.toFixed(2)} h)`,
        `Temperatura ambiente ${favorable.solar.ambientC.toFixed(0)} °C`,
        'Red: +1 h respecto al patrón introducido',
      ],
      config: favorable,
    },
    {
      id: 'habitual',
      label: 'Habitual',
      description: 'Las hipótesis que has introducido en la calculadora.',
      assumptions: [
        `HSP ${base.solar.hsp.toFixed(2)} h`,
        `Temperatura ambiente ${base.solar.ambientC.toFixed(0)} °C`,
        'Red: patrón introducido',
      ],
      config: base,
    },
    {
      id: 'desfavorable',
      label: 'Desfavorable',
      description: 'Menos sol, más calor, más sombras y menos red.',
      assumptions: [
        `HSP ${unfavorable.solar.hsp.toFixed(2)} h (base ${base.solar.hsp.toFixed(2)} h)`,
        `Temperatura ambiente ${unfavorable.solar.ambientC.toFixed(0)} °C`,
        'Red: −1 h respecto al patrón introducido',
      ],
      config: unfavorable,
    },
  ];
}
