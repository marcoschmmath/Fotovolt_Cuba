/**
 * Planificación de las actividades de cocción.
 *
 * La cocción NO es un electrodoméstico con horario fijo: es una actividad que
 * exige una potencia durante un rato, que puede ocurrir en un instante u otro
 * dentro de una ventana, y que cuando no se puede hacer con electricidad puede
 * hacerse con carbón o gas.
 *
 * Este módulo decide, para cada comida:
 *   1. en qué intervalos se cocina (hora de preparación);
 *   2. si se cocina con electricidad o con el combustible alternativo;
 *   3. cuánta demanda eléctrica extra añade cada intervalo.
 *
 * Lo que NO decide aquí: si la batería aguanta. Eso lo resuelve el motor con
 * sus límites reales y su reserva nocturna, y los fallos se informan desde
 * allí. Este módulo es transparente a propósito: sus criterios son pocos y
 * legibles (red disponible, PV suficiente, equipo capaz), no un optimizador.
 */

import type { CookingActivity, CookingSubstitution } from '../household/types';
import type { CookingPlanSummary, CookingPlacement, DesignParams } from '../core/types';
import { intervalCount } from '../calculator/energy';

export type CookingMode = 'usual' | 'flexible';
export type { CookingPlanSummary, CookingPlacement };

export interface CookingPlanInput {
  activities: CookingActivity[];
  /** Demanda del resto de la vivienda por intervalo (W). */
  baseDemandW: number[];
  /** Producción PV disponible en AC por intervalo (W, a la salida del inversor). */
  pvAvailableAcW: number[];
  gridAvailable: boolean[];
  /** Potencia máxima de salida AC del inversor (W). */
  inverterAcLimitW: number;
  /** Potencia máxima que la batería puede entregar a AC (W). */
  batteryAcLimitW: number;
  /** Potencia máxima de importación de la vivienda (W). */
  gridImportLimitW: number;
  params: DesignParams;
  mode: CookingMode;
  substitution: CookingSubstitution;
  /** El hogar declara combustible alternativo. */
  hasFuel: boolean;
}

export interface CookingPlanResult extends CookingPlanSummary {
  /** Demanda eléctrica extra por intervalo (W). */
  demandAddW: number[];
}

/** Hora de preparación preferida: servir la comida menos la duración del proceso. */
export function preferredPrepStartHour(activity: CookingActivity): number {
  const raw = activity.mealHour - activity.durationMinutes / 60;
  return Math.max(activity.windowStartHour, Math.min(activity.windowEndHour - activity.durationMinutes / 60, raw));
}

function intervalsFor(params: DesignParams): number {
  return intervalCount(params);
}

export function planCooking(input: CookingPlanInput): CookingPlanResult {
  const count = intervalsFor(input.params);
  const dtHours = input.params.stepMinutes / 60;
  const stepIntervals = Math.max(1, Math.round(1 / dtHours));
  const demandAddW = new Array<number>(count).fill(0);
  const placements: CookingPlacement[] = [];
  let avoidedDemandKwh = 0;
  let mealsCoveredByFuel = 0;

  for (const activity of input.activities) {
    // Sin gas/carbón declarado, las comidas no se pueden borrar de la demanda:
    // se programan eléctricamente y el motor informa si faltan recursos.
    if ((!activity.enabled && input.hasFuel) || activity.powerW <= 0 || activity.durationMinutes <= 0) continue;
    const duration = Math.max(1, Math.round(activity.durationMinutes / input.params.stepMinutes));
    const windowStart = Math.round(activity.windowStartHour / dtHours);
    const windowEnd = Math.min(count - 1, Math.round(activity.windowEndHour / dtHours));
    const windowTooShort = windowEnd - windowStart < duration;
    if (windowTooShort && input.hasFuel) continue;
    const preferredStart = Math.round(preferredPrepStartHour(activity) / dtHours);

    const candidates: number[] = [];
    if (!windowTooShort) {
      for (let start = windowStart; start + duration <= windowEnd + 1; start += stepIntervals) {
        candidates.push(start);
      }
    }
    // Si no hay combustible alternativo, la comida no desaparece por una
    // ventana mal configurada: se conserva completa empezando lo más cerca
    // posible del inicio permitido. El sistema asumirá esa demanda eléctrica.
    if (!candidates.length && !input.hasFuel) {
      candidates.push(Math.min(count - duration, Math.max(0, windowStart)));
    }
    if (!candidates.length) continue;
    const choose = input.mode === 'usual' ? candidates.reduce((a, b) => (Math.abs(b - preferredStart) < Math.abs(a - preferredStart) ? b : a), candidates[0]) : undefined;

    /** ¿Red o PV cubren solos el proceso en este intervalo? */
    const coveredAt = (index: number): boolean => {
      if (input.gridAvailable[index]) return true;
      const netPv = input.pvAvailableAcW[index] - input.baseDemandW[index];
      return netPv >= activity.powerW * 0.95;
    };

    const batteryCanDoIt =
      input.inverterAcLimitW >= activity.powerW && input.batteryAcLimitW >= activity.powerW;

    const eventCoverage = (start: number): number => {
      let covered = 0;
      for (let k = 0; k < duration; k += 1) {
        if (coveredAt((start + k) % count)) covered += 1;
      }
      return covered / duration;
    };

    /** Cuánta energía tendría que salir de la batería (kWh) con este comienzo. */
    const batteryDrawKwh = (start: number): number => {
      let kwh = 0;
      for (let k = 0; k < duration; k += 1) {
        const index = (start + k) % count;
        if (input.gridAvailable[index]) continue;
        const netPv = input.pvAvailableAcW[index] - input.baseDemandW[index];
        if (netPv >= activity.powerW * 0.95) continue;
        kwh += activity.powerW * dtHours;
      }
      return kwh / 1000;
    };

    let start: number;
    if (choose !== undefined) {
      start = choose;
    } else {
      // Flexible: prefiere red, luego PV, luego el mínimo gasto de batería, y
      // rompe empates acercándose a la hora preferida. Nunca cocina de
      // madrugada (entre las 00:00 y las 05:00) si hay otra opción.
      let best = candidates[0];
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const candidate of candidates) {
        const coverage = eventCoverage(candidate);
        const draw = batteryDrawKwh(candidate);
        const hour = candidate * dtHours;
        const nightPenalty = hour < 5 ? -0.6 : 0;
        const score =
          coverage * 100 +
          -draw * 4 +
          -Math.abs(candidate - preferredStart) * 0.05 +
          nightPenalty;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      start = best;
    }

    const coverage = eventCoverage(start);
    const needsBattery = coverage < 0.999;
    const fuelUsed =
      needsBattery &&
      input.hasFuel &&
      (input.substitution === 'fuel-first' || !batteryCanDoIt) &&
      input.substitution !== 'never';

    // Misma duración que simula el motor (redondeada al paso): la energía
    // evitada y la servida se miden con el mismo criterio.
    const energyKwh = (activity.powerW * duration * dtHours) / 1000;

    if (fuelUsed) {
      mealsCoveredByFuel += 1;
      avoidedDemandKwh += energyKwh;
      placements.push({
        activityId: activity.id,
        label: activity.label,
        startIndex: start,
        intervals: duration,
        powerW: activity.powerW,
        windowStartIndex: windowStart,
        windowEndIndex: windowEnd,
        coveredByFuel: true,
        avoidedDemandKwh: energyKwh,
        electricalCoverage: 0,
      });
      continue;
    }

    for (let k = 0; k < duration; k += 1) {
      demandAddW[(start + k) % count] += activity.powerW;
    }
    placements.push({
      activityId: activity.id,
      label: activity.label,
      startIndex: start,
      intervals: duration,
      powerW: activity.powerW,
      windowStartIndex: windowStart,
      windowEndIndex: windowEnd,
      coveredByFuel: false,
      avoidedDemandKwh: 0,
      electricalCoverage: coverage,
    });
  }

  return { placements, demandAddW, avoidedDemandKwh, mealsCoveredByFuel };
}

/** Resumen legible de una actividad para la interfaz. */
export function cookingActivitySummary(activity: CookingActivity): string {
  const hours = activity.durationMinutes / 60;
  return `${activity.label}: ${activity.powerW} W durante ${hours.toFixed(1)} h (estimación declarada, editable)`;
}