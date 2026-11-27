import type { DesignParams, GridModel } from '../core/types';
import { intervalCount, wrapHours } from '../calculator/energy';

export type GridPattern = 'morning' | 'evening' | 'split' | 'custom';

export interface GridInput {
  hoursPerDay: number;
  pattern: GridPattern;
  startHour: number;
  maxPowerW: number;
  voltage: 110 | 220 | 'both';
}

/**
 * Construye la disponibilidad horaria de la red a partir de las horas que el
 * usuario dice tener. Es un patrón ilustrativo, no un dato medido.
 */
export function buildGridModel(input: GridInput, params: DesignParams): GridModel {
  const count = intervalCount(params);
  const available = new Array<boolean>(count).fill(false);
  const intervalsPerHour = 60 / params.stepMinutes;
  const total = Math.max(0, Math.min(24, input.hoursPerDay)) * intervalsPerHour;

  let blocks: Array<{ start: number; intervals: number }> = [];
  if (input.pattern === 'split') {
    const first = Math.ceil(total / 2);
    blocks = [
      { start: 6 * intervalsPerHour, intervals: first },
      { start: 18 * intervalsPerHour, intervals: total - first },
    ];
  } else {
    const startHour = input.pattern === 'morning' ? 6 : input.pattern === 'evening' ? 18 : input.startHour;
    blocks = [{ start: wrapHours(startHour) * intervalsPerHour, intervals: total }];
  }

  for (const block of blocks) {
    for (let i = 0; i < block.intervals; i += 1) {
      const index = (block.start + i) % count;
      available[index] = true;
    }
  }

  return {
    available,
    maxPowerW: Math.max(0, input.maxPowerW),
    voltage: input.voltage,
  };
}

export function gridHoursPerDay(grid: GridModel, params: DesignParams): number {
  return grid.available.reduce((sum, on) => sum + (on ? params.stepMinutes / 60 : 0), 0);
}
