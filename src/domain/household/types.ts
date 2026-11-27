/**
 * Entidades de consumo del hogar. NO contienen nada de la instalación
 * fotovoltaica: un hogar se configura una vez y se reutiliza en todas las
 * instalaciones que se quieran evaluar.
 */

import type { Appliance, DesignParams, Priority, Schedule } from '../core/types';

/** Identificador estable de las tres comidas modeladas. */
export type MealId = 'breakfast' | 'lunch' | 'dinner';

/**
 * Una actividad de cocción eléctrica. La hora de la comida (servir) y la hora
 * de preparación NO son la misma: la preparación se puede mover dentro de la
 * ventana aceptable SIN cambiar la hora de servir la comida.
 */
export interface CookingActivity {
  id: MealId;
  label: string;
  /** Hora del día a la que se sirve la comida (0-24). */
  mealHour: number;
  /** Inicio de la ventana aceptable de preparación eléctrica (horas). */
  windowStartHour: number;
  /** Fin de la ventana aceptable de preparación eléctrica (horas). */
  windowEndHour: number;
  /**
   * Equipos de cocina declarados en el perfil que usa esta actividad. Si está
   * vacío se usan la potencia y duración estimadas declaradas abajo.
   */
  applianceIds: string[];
  /** Potencia eléctrica estimada del proceso de cocción completa (W). */
  powerW: number;
  /** Duración estimada del proceso de cocción completa (minutos). */
  durationMinutes: number;
  /** La familia considera imprescindible cocinar eléctricamente. */
  essential: boolean;
  /** true si la actividad se simula (se puede desactivar sin borrarla). */
  enabled: boolean;
}

/** Combustible alternativo disponible en la vivienda. */
export type CookingFuelKind = 'charcoal' | 'gas' | 'other';

/**
 * Política cuando la cocción eléctrica no se puede cubrir con red o con el
 * propio sol (es decir, tocaría la batería):
 *  - `electric-first`: se cocina eléctrico si la batería puede hacerlo; la
 *    simulación muestra el coste sobre la reserva y el fallo si no alcanza.
 *  - `fuel-first`: se cocina con carbón/gas en cuanto haga falta tocar batería.
 *  - `never`: nunca se sustituye; la simulación informa del fallo con honestidad.
 */
export type CookingSubstitution = 'electric-first' | 'fuel-first' | 'never';

export interface CookingPreferences {
  enabled: boolean;
  /** Combustible alternativo declarado; null = la vivienda no tiene. */
  fuelKind: CookingFuelKind | null;
  /** true cuando el usuario confirmó explícitamente que dispone de ese combustible. */
  fuelConfirmed: boolean;
  substitution: CookingSubstitution;
  /** Permite adelantar/retrasar la preparación dentro de la ventana. */
  allowFlexibleTiming: boolean;
}

/** Comodidad nocturna: qué equipos son esenciales de noche. */
export interface NightComfort {
  /** Ids de electrodomésticos considerados esenciales en la franja nocturna. */
  essentialIds: string[];
}

/**
 * Perfil de una vivienda: consumo y hábitos. Reutilizable en todas las
 * instalaciones. Sin paneles, sin baterías, sin inversor.
 */
export interface HouseholdProfile {
  id: string;
  name: string;
  appliances: Appliance[];
  cooking: CookingPreferences;
  activities: CookingActivity[];
  night: NightComfort;
  /** Tensión de servicio declarada por el hogar. */
  voltage: 110 | 220 | 'both';
  createdAt: string;
  updatedAt: string;
}

/** Resumen de consumo del hogar, para pantallas y migraciones. */
export interface HouseholdSummary {
  dailyKwh: number;
  nightKwh: number;
  peakSimultaneousW: number;
}

export function isNightEssential(appliance: Appliance, night: NightComfort): boolean {
  return night.essentialIds.includes(appliance.id);
}

/** Prioridad efectiva de un equipo: los esenciales de noche no bajan de «importante». */
export function effectivePriority(appliance: Appliance, night: NightComfort): Priority {
  if (isNightEssential(appliance, night) && appliance.priority === 'discretionary') {
    return 'important';
  }
  return appliance.priority;
}

export const DEFAULT_COOKING: CookingPreferences = {
  enabled: true,
  // No se presume que la vivienda tenga gas/carbón: debe declararlo el usuario.
  fuelKind: null,
  fuelConfirmed: false,
  substitution: 'electric-first',
  allowFlexibleTiming: true,
};

/**
 * Valores por defecto de las tres actividades. Son ESTIMACIONES declaradas
 * (una olla arrocera/inducción de 900 W durante 1 h), no datos medidos: la
 * interfaz las muestra como editables y el perfil guarda lo que el usuario
 * introduzca.
 */
export function defaultCookingActivities(): CookingActivity[] {
  return [
    {
      id: 'breakfast',
      label: 'Desayuno',
      mealHour: 7,
      windowStartHour: 6.5,
      windowEndHour: 8,
      applianceIds: [],
      powerW: 500,
      durationMinutes: 30,
      essential: false,
      enabled: true,
    },
    {
      id: 'lunch',
      label: 'Almuerzo',
      mealHour: 13,
      windowStartHour: 11,
      windowEndHour: 13.75,
      applianceIds: [],
      powerW: 900,
      durationMinutes: 60,
      essential: true,
      enabled: true,
    },
    {
      id: 'dinner',
      label: 'Comida',
      mealHour: 20.5,
      windowStartHour: 18,
      windowEndHour: 20.75,
      applianceIds: [],
      powerW: 900,
      durationMinutes: 60,
      essential: true,
      enabled: true,
    },
  ];
}

export const COOKING_FUEL_LABELS: Record<CookingFuelKind, string> = {
  charcoal: 'Carbón',
  gas: 'Gas',
  other: 'Otro método',
};

export const SUBSTITUTION_LABELS: Record<CookingSubstitution, string> = {
  'electric-first': 'Cocinar eléctrico si la batería puede; si no, usar el combustible alternativo',
  'fuel-first': 'Usar el combustible alternativo en cuanto haga falta tocar la batería',
  never: 'Cocinar siempre eléctrico e informar de los fallos',
};

export type { Appliance, DesignParams, Schedule };