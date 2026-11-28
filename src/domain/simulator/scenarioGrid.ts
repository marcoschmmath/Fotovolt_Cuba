/**
 * Evaluación de una instalación sobre el conjunto COMPLETO de escenarios.
 *
 * Todas las instalaciones y variantes de comportamiento usan exactamente los
 * mismos 24 escenarios de retorno de red más el apagón total: así las
 * comparaciones son coherentes y ninguna configuración se beneficia de un
 * escenario distinto.
 */

import type { Diagnostic, EnergySystemConfig, SimulationResult } from '../core/types';
import { isWithinWindow } from '../calculator/energy';
import type { HouseholdProfile } from '../household/types';
import type { SystemConfiguration } from '../system/types';
import { prepareSimulation, simulate, type CookingRuntimeInput } from './engine';
import { batteryPack } from '../calculator/battery';
import {
  BLACKOUT_SCENARIO_ID,
  GRID_RETURN_SCENARIO_COUNT,
  blackoutScenario,
  gridReturnScenarios,
  type GridReturnScenario,
} from './gridScenarios';
import { buildEnergySystemConfig, socFloorByInterval, type BridgeInput } from './bridge';

export type CookingMode = 'usual' | 'flexible';

/** Datos de una entrada a evaluar (hogar + instalación + equipo resuelto). */
export interface EvaluationInput {
  household: HouseholdProfile;
  system: SystemConfiguration;
  panel: EnergySystemConfig['panel'];
  battery: EnergySystemConfig['battery'];
  inverter: EnergySystemConfig['inverter'];
}

export interface ScenarioOutcome {
  scenarioId: string;
  label: string;
  startHour: number;
  isBlackout: boolean;
  /** Cobertura de la demanda eléctrica (0-1). */
  coverage: number;
  unservedKwh: number;
  unservedCriticalKwh: number;
  gridKwh: number;
  pvUsedKwh: number;
  batteryDischargeKwh: number;
  batteryChargeKwh: number;
  curtailedKwh: number;
  finalSoc: number;
  minSoc: number;
  /** Comidas que no se pudieron preparar con electricidad. */
  cookingMealsUnmet: number;
  /** Comidas cubiertas con combustible alternativo. */
  cookingMealsSubstituted: number;
  cookingEnergyAvoidedKwh: number;
  /** Déficit frente a la energía esencial de noche (kWh). */
  nightDeficitKwh: number;
  diagnostics: Diagnostic[];
}

export interface BehaviorOutcome {
  mode: CookingMode;
  scenarios: ScenarioOutcome[];
  blackout: ScenarioOutcome;
  /** Mediana de cobertura sobre las 24 horas de retorno. */
  coverageMedian: number;
  coverageWorst: number;
  coverageBest: number;
  /** Amplitud de la variación entre la mejor y la peor hora de retorno. */
  variation: number;
  unservedKwhWorst: number;
  /** Mediana de la energía importada de la red sobre los 24 casos (kWh). */
  gridKwhMedian: number;
  /** Mediana de la energía PV aprovechada sobre los 24 casos (kWh). */
  pvKwhMedian: number;
  nightDeficitKwhWorst: number;
  cookingMealsUnmetWorst: number;
  /** SOC real de partida: 30 %, o el mínimo físico si el banco exige más. */
  initialSoc: number;
  /** El banco acaba cada escenario normal con al menos el SOC de partida. */
  energySustainable: boolean;
  diagnostics: Diagnostic[];
}

export interface SystemEvaluation {
  behaviors: Record<CookingMode, BehaviorOutcome>;
  scenarios: GridReturnScenario[];
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregateMedian(values: number[]): number {
  return median(values);
}

function outcomeOf(
  scenario: GridReturnScenario,
  result: SimulationResult,
  nightWindow: { start: number; end: number },
): ScenarioOutcome {
  const { totals } = result;
  // Déficit de noche: energía esencial que quedó sin servir DENTRO de la
  // franja nocturna del hogar. No es un porcentaje arbitrario: es lo que el
  // hogar necesitaba y el sistema no pudo dar.
  const nightDeficitKwh = result.summary?.nightDeficitKwh ?? result.intervals.reduce((sum, interval) => {
    const isNight = isWithinWindow(interval.hour, nightWindow.start, nightWindow.end) && nightWindow.start !== nightWindow.end;
    return sum + (isNight ? interval.unservedByPriorityKwh.critical : 0);
  }, 0);
  return {
    scenarioId: scenario.id,
    label: scenario.label,
    startHour: scenario.startHour,
    isBlackout: scenario.id === BLACKOUT_SCENARIO_ID,
    coverage: totals.coverage,
    unservedKwh: totals.unservedKwh,
    unservedCriticalKwh: totals.unservedByPriorityKwh.critical,
    gridKwh: totals.gridKwh,
    pvUsedKwh: totals.pvUsedKwh,
    batteryDischargeKwh: totals.batteryDischargeKwh,
    batteryChargeKwh: totals.batteryChargeKwh,
    curtailedKwh: totals.curtailedKwh,
    finalSoc: totals.finalSoc,
    minSoc: totals.minSoc,
    cookingMealsUnmet: totals.cookingMealsUnmet,
    cookingMealsSubstituted: totals.cookingMealsSubstituted,
    cookingEnergyAvoidedKwh: totals.cookingEnergyAvoidedKwh,
    nightDeficitKwh,
    diagnostics: result.diagnostics,
  };
}

function aggregate(
  mode: CookingMode,
  scenarios: ScenarioOutcome[],
  blackout: ScenarioOutcome,
  initialSoc: number,
): BehaviorOutcome {
  const coverages = scenarios.map((s) => s.coverage);
  return {
    mode,
    scenarios,
    blackout,
    coverageMedian: aggregateMedian(coverages),
    coverageWorst: Math.min(...coverages),
    coverageBest: Math.max(...coverages),
    variation: Math.max(...coverages) - Math.min(...coverages),
    unservedKwhWorst: Math.max(...scenarios.map((s) => s.unservedKwh)),
    gridKwhMedian: aggregateMedian(scenarios.map((s) => s.gridKwh)),
    pvKwhMedian: aggregateMedian(scenarios.map((s) => s.pvUsedKwh)),
    nightDeficitKwhWorst: Math.max(...scenarios.map((s) => s.nightDeficitKwh), 0),
    cookingMealsUnmetWorst: Math.max(...scenarios.map((s) => s.cookingMealsUnmet), 0),
    initialSoc,
    // Si el SOC final cae por debajo del inicial, el sistema está consumiendo
    // energía heredada y no repetiría indefinidamente el mismo día.
    energySustainable: scenarios.every((s) => s.finalSoc >= initialSoc - 0.005),
    diagnostics: [],
  };
}

/**
 * Evalúa una instalación sobre los 24 escenarios + apagón total, para los dos
 * comportamientos de cocción. Devuelve el conjunto completo (el motor corre
 * 50 veces sobre series de 96 intervalos: sigue siendo análisis instantáneo).
 */
interface BehaviorEvaluationOptions {
  /** No almacenar IntervalResult cuando sólo se está filtrando un candidato. */
  collectIntervals?: boolean;
  /** Rechazar en cuanto un escenario viola una de las condiciones de aceptación. */
  rejectIncompatibleEarly?: boolean;
  onScenarioEvaluated?: (scenario: GridReturnScenario) => void;
  onScenarioRejected?: (scenario: GridReturnScenario, reasons: string[]) => void;
}

function scenarioPassesRecommendationCriteria(
  outcome: ScenarioOutcome,
  initialSoc: number,
): boolean {
  return outcome.coverage >= 0.999 &&
    outcome.finalSoc >= initialSoc - 0.005 &&
    outcome.cookingMealsUnmet === 0;
}

function evaluateBehavior(
  input: EvaluationInput,
  mode: CookingMode,
  options: BehaviorEvaluationOptions = {},
): BehaviorOutcome | null {
  const { household, system } = input;
  const params = system.params;
  const floor = socFloorByInterval(household, params, input.battery, system.batteryCount, input.inverter);
  const pack = batteryPack(input.battery, system.batteryCount, params);
  const initialSoc = Math.min(1, Math.max(pack.minSoc, 0.30));
  const scenarios = gridReturnScenarios(params);
  const blackout = blackoutScenario(params);
  const cooking: CookingRuntimeInput = {
    activities: household.activities,
    mode,
    substitution: household.cooking.substitution,
    hasFuel: household.cooking.fuelKind !== null && household.cooking.fuelConfirmed,
  };
  const bridge = (gridAvailable: boolean[]): BridgeInput => ({
    household,
    system,
    panel: input.panel,
    battery: input.battery,
    inverter: input.inverter,
    gridAvailable,
  });

  // Todo lo que no depende de la presencia de red se construye una sola vez.
  // Entre escenarios sólo cambia grid.available y, por tanto, el estado dinámico.
  const baseConfig = buildEnergySystemConfig(bridge(scenarios[0]?.available ?? blackout.available));
  const prepared = prepareSimulation(baseConfig);
  const run = (gridAvailable: boolean[]) =>
    simulate({
      ...baseConfig,
      grid: { ...baseConfig.grid, available: gridAvailable },
    }, {
      cooking,
      socFloorByInterval: floor,
      startHour: 8,
      startSoc: initialSoc,
      prepared,
      collectIntervals: options.collectIntervals !== false,
    });

  const nightWindow = { start: params.nightStart, end: params.nightEnd };
  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of scenarios) {
    const outcome = outcomeOf(scenario, run(scenario.available), nightWindow);
    outcomes.push(outcome);
    options.onScenarioEvaluated?.(scenario);
    if (options.rejectIncompatibleEarly && !scenarioPassesRecommendationCriteria(outcome, initialSoc)) {
      const reasons: string[] = [];
      if (outcome.coverage < 0.999) reasons.push(`cobertura ${(outcome.coverage * 100).toFixed(2)} % (< 99,9 %)`);
      if (outcome.finalSoc < initialSoc - 0.005) {
        reasons.push(`SOC final ${(outcome.finalSoc * 100).toFixed(2)} % por debajo del umbral ${((initialSoc - 0.005) * 100).toFixed(2)} %`);
      }
      if (outcome.cookingMealsUnmet > 0) reasons.push(`${outcome.cookingMealsUnmet} comida(s) eléctricas sin atender`);
      options.onScenarioRejected?.(scenario, reasons);
      return null;
    }
  }

  // El apagón total no forma parte del criterio de aceptación. Se calcula
  // sólo después de que los 24 escenarios normales hayan superado el filtro.
  const blackoutOutcome = outcomeOf(blackout, run(blackout.available), nightWindow);
  options.onScenarioEvaluated?.(blackout);
  return aggregate(mode, outcomes, blackoutOutcome, initialSoc);
}

/** Evalúa un único comportamiento; el recomendador sólo necesita el habitual. */
export function evaluateSystemBehavior(
  input: EvaluationInput,
  mode: CookingMode = 'usual',
): BehaviorOutcome {
  const outcome = evaluateBehavior(input, mode);
  if (!outcome) throw new Error('La evaluación completa no debe rechazar escenarios anticipadamente.');
  return outcome;
}

/**
 * Validador del recomendador: devuelve null en el primer escenario que no
 * cumple exactamente el criterio actual. Sólo si los 24 pasan evalúa el
 * apagón total y produce todas las métricas de la recomendación.
 */
export function evaluateCompatibleSystemBehavior(
  input: EvaluationInput,
  mode: CookingMode = 'usual',
  onScenarioEvaluated?: (scenario: GridReturnScenario) => void,
  onScenarioRejected?: (scenario: GridReturnScenario, reasons: string[]) => void,
): BehaviorOutcome | null {
  return evaluateBehavior(input, mode, {
    // Until compact-vs-detailed equivalence is stress-tested with cooking and
    // custom grid profiles, keep the same interval materialization as Result.
    collectIntervals: true,
    rejectIncompatibleEarly: true,
    onScenarioEvaluated,
    onScenarioRejected,
  });
}

/** Evaluación completa utilizada por Resultados y Comparaciones. */
export function evaluateSystem(input: EvaluationInput): SystemEvaluation {
  const usual = evaluateBehavior(input, 'usual');
  const flexible = evaluateBehavior(input, 'flexible');
  if (!usual || !flexible) throw new Error('La evaluación completa no debe rechazar escenarios anticipadamente.');
  return {
    behaviors: { usual, flexible },
    scenarios: gridReturnScenarios(input.system.params),
  };
}

/** Resumen compacto de una evaluación, para guardar como foto (snapshot). */
export function summarizeEvaluation(evaluation: SystemEvaluation): {
  coverageMedian: number;
  coverageWorst: number;
  coverageBest: number;
  unservedKwhWorst: number;
  blackoutCoverage: number;
  blackoutUnservedKwh: number;
  cookingMealsUnmetWorst: number;
  nightDeficitKwhWorst: number;
  minSocWorst: number;
} {
  const usual = evaluation.behaviors.usual;
  return {
    coverageMedian: usual.coverageMedian,
    coverageWorst: usual.coverageWorst,
    coverageBest: usual.coverageBest,
    unservedKwhWorst: usual.unservedKwhWorst,
    blackoutCoverage: usual.blackout.coverage,
    blackoutUnservedKwh: usual.blackout.unservedKwh,
    cookingMealsUnmetWorst: usual.cookingMealsUnmetWorst,
    nightDeficitKwhWorst: usual.nightDeficitKwhWorst,
    minSocWorst: Math.min(...usual.scenarios.map((s) => s.minSoc), 1),
  };
}

export { GRID_RETURN_SCENARIO_COUNT };