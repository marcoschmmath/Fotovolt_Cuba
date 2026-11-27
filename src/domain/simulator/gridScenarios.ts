/**
 * Escenarios de retorno de la red eléctrica.
 *
 * Modelo: una única ventana continua de disponibilidad de 3 horas al día, con
 * 24 comienzos representativos separados una hora (00:00–03:00 … 23:00–02:00).
 * A 15 minutos de paso, cada ventana contiene exactamente 12 intervalos y las
 * ventanas pueden cruzar la medianoche.
 *
 * Es un ANÁLISIS REPRESENTATIVO, no una afirmación sobre la distribución real
 * de los apagones en Cuba. Lo importante es que TODAS las instalaciones y
 * variantes de comportamiento usen exactamente el mismo conjunto de
 * escenarios, para que las comparaciones sean coherentes.
 *
 * Generación determinista: los identificadores y el contenido no dependen de
 * la instalación evaluada.
 */

import type { DesignParams } from '../core/types';
import { intervalCount } from '../calculator/energy';

/** Duración de la ventana de disponibilidad diaria, en horas. */
export const GRID_RETURN_WINDOW_HOURS = 3;

/** Número de comienzos representativos por día. */
export const GRID_RETURN_SCENARIO_COUNT = 24;

/** Identificador del escenario de apagón total. */
export const BLACKOUT_SCENARIO_ID = 'blackout';

export interface GridReturnScenario {
  /** Identificador estable y reproducible: `rt-00` … `rt-23`. */
  id: string;
  /** Hora de comienzo de la ventana (0-23). */
  startHour: number;
  /** Etiqueta legible del tramo, p. ej. `09:00 – 12:00`. */
  label: string;
  /** Disponibilidad por intervalo; longitud = intervalos del día. */
  available: boolean[];
}

/** Disponibilidad de una ventana de `windowHours` que empieza en `startHour`. */
export function windowAvailability(params: DesignParams, startHour: number, windowHours: number): boolean[] {
  const count = intervalCount(params);
  const dt = params.stepMinutes / 60;
  const intervalsInWindow = Math.round((windowHours * 60) / params.stepMinutes);
  return Array.from({ length: count }, (_, index) => {
    const intervalStartHour = index * dt;
    const offsetFromStart = ((intervalStartHour - startHour) % 24 + 24) % 24;
    return offsetFromStart < (intervalsInWindow * dt - 1e-9);
  });
}

function formatHour(hour: number): string {
  const h = Math.round(hour * 60) / 60;
  return `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
}

/**
 * Los 24 escenarios representativos. `params` sólo determina el número de
 * intervalos del día: la generación es idéntica para cualquier instalación.
 */
export function gridReturnScenarios(params: DesignParams): GridReturnScenario[] {
  return Array.from({ length: GRID_RETURN_SCENARIO_COUNT }, (_, startHour) => {
    const endHour = (startHour + GRID_RETURN_WINDOW_HOURS) % 24;
    return {
      id: `rt-${String(startHour).padStart(2, '0')}`,
      startHour,
      label: `${formatHour(startHour)} – ${formatHour(endHour)}`,
      available: windowAvailability(params, startHour, GRID_RETURN_WINDOW_HOURS),
    };
  });
}

/** Escenario de apagón total: 24 h sin red eléctrica. */
export function blackoutScenario(params: DesignParams): GridReturnScenario {
  return {
    id: BLACKOUT_SCENARIO_ID,
    startHour: 0,
    label: 'Apagón total (24 h)',
    available: new Array<boolean>(intervalCount(params)).fill(false),
  };
}

/** Escenarios de atención prioritaria para el cliente (comida y noche). */
export const HIGHLIGHT_SCENARIO_IDS: ReadonlyArray<{ id: string; why: string }> = [
  { id: 'rt-09', why: 'Red de 09:00 a 12:00: permite cocinar con corriente el almuerzo' },
  { id: 'rt-14', why: 'Red de 14:00 a 17:00: recarga a media tarde' },
  { id: 'rt-18', why: 'Red al atardecer: cubre Iluminación y la comida' },
  { id: 'rt-00', why: 'Red de madrugada: recarga nocturna' },
];

export function scenarioById(id: string, params: DesignParams): GridReturnScenario {
  if (id === BLACKOUT_SCENARIO_ID) return blackoutScenario(params);
  const start = Number(id.replace('rt-', ''));
  return gridReturnScenarios(params)[Number.isFinite(start) ? Math.max(0, Math.min(23, start)) : 0];
}