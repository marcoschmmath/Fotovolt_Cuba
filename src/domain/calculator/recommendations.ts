import type {
  BatterySpec,
  DesignParams,
  InverterSpec,
  PanelSpec,
} from '../core/types';
import type { HouseholdProfile } from '../household/types';
import type { SystemConfiguration } from '../system/types';
import { householdForRecommendation, type RecommendationTierId } from '../household/recommendationProfile';
import { analyzeEnergy, isWithinWindow, peakDesignW, type EnergyBreakdown } from './energy';
import { requiredBatteryNominalKwh } from './battery';
import { requiredPvWatts } from './sizing';
import { checkBalancedArrayConfiguration, type BalancedArrayConfigurationCheck } from './pv';
import { checkInverterCompatibility, inverterWithParallelUnits } from './inverter';
import { evaluateCompatibleSystemBehavior } from '../simulator/scenarioGrid';

export type { RecommendationTierId } from '../household/recommendationProfile';

export interface RecommendationTier {
  id: RecommendationTierId;
  label: string;
  description: string;
  batteryMargin: number;
  inverterMargin: number;
}

export const RECOMMENDATION_TIERS: RecommendationTier[] = [
  {
    id: 'essential',
    label: 'Esencial',
    description: 'Prioriza los equipos críticos y los que marcaste como imprescindibles durante la noche.',
    batteryMargin: 1,
    inverterMargin: 1,
  },
  {
    id: 'moderate',
    label: 'Moderada',
    description: 'Incluye los equipos críticos e importantes, con una reserva adicional de capacidad.',
    batteryMargin: 1.12,
    inverterMargin: 1.12,
  },
  {
    id: 'roomy',
    label: 'Holgada',
    description: 'Contempla todos los equipos declarados y añade margen de batería y potencia en el inversor.',
    batteryMargin: 1.25,
    inverterMargin: 1.25,
  },
];

export interface SolarRecommendation {
  tier: RecommendationTierId;
  label: string;
  description: string;
  panel: PanelSpec;
  panelCount: number;
  battery: BatterySpec;
  batteryCount: number;
  inverter: InverterSpec;
  inverterCount: number;
  installedPvW: number;
  installedBatteryKwh: number;
  targetBatteryKwh: number;
  targetPvW: number;
  requiredPeakW: number;
  simulatedDemandKwh: number;
  simulatedPvKwh: number;
  /** SOC de partida que usa scenarioGrid (30 % o el mínimo físico si es mayor). */
  initialSoc: number;
  /** Menor SOC final entre los 24 escenarios de retorno de red. */
  finalSocWorst: number;
  /** Cobertura mínima de los 24 escenarios de retorno de red. */
  coverageWorst: number;
  energySustainable: boolean;
  cookingMealsUnmetWorst: number;
  /** Prueba independiente de apagón total; no sustituye el criterio normal de compatibilidad. */
  blackoutCoverage: number;
  blackoutUnservedKwh: number;
  unservedKwh: number;
  technicalStatus: 'verified' | 'partial';
  warnings: string[];
  estimatedPrice?: number;
  currency?: 'USD' | 'CUP';
}

export interface RecommendationCard {
  tier: RecommendationTier;
  recommendation: SolarRecommendation | null;
  reason: string | null;
}

export interface RecommendationInput {
  household: HouseholdProfile;
  panels: PanelSpec[];
  batteries: BatterySpec[];
  inverters: InverterSpec[];
  params: DesignParams;
}

export interface RecommendationProgress {
  tierId: RecommendationTierId;
  phase: 'preparing' | 'generating' | 'validating' | 'complete';
  candidatesGenerated: number;
  candidatesValidated: number;
  scenariosEvaluated: number;
}

export interface RecommendationGenerationOptions {
  onProgress?: (progress: RecommendationProgress) => void;
  onTierComplete?: (card: RecommendationCard) => void;
}

interface CandidateSearchInput extends RecommendationInput {
  tier: RecommendationTier;
  scenarioHousehold: HouseholdProfile;
  /** Demanda de electrodomésticos, igual que la que usa Result.tsx en el chequeo técnico. */
  energy: EnergyBreakdown;
  /** Demanda diaria incluyendo las actividades de cocina para dimensionar energía. */
  sizingEnergy: EnergyBreakdown;
}

export const RECOMMENDATION_LIMITS = { maxPanels: 50, maxBatteries: 10 } as const;
const MAX_PANEL_COUNT = RECOMMENDATION_LIMITS.maxPanels;
const MAX_BATTERY_COUNT = RECOMMENDATION_LIMITS.maxBatteries;

/** Rango solicitado para la capacidad nominal total del banco nocturno. */
export function batteryBankFitsNightEnergy(nightKwh: number, bankKwh: number): boolean {
  if (!(bankKwh > 0) || !Number.isFinite(bankKwh)) return false;
  if (!(nightKwh > 0)) return true;
  return 3 * bankKwh > nightKwh && bankKwh <= 2 * nightKwh;
}

/** Cota inferior exacta para restricciones que escalan linealmente al paralelizar. */
export function minimumParallelUnitsForCandidate(options: {
  inverter: InverterSpec;
  battery: BatterySpec;
  targetPvW: number;
  requiredContinuousW: number;
  requiredPeakW: number;
  params: DesignParams;
}): number {
  const { inverter, battery, targetPvW, requiredContinuousW, requiredPeakW, params } = options;
  const dischargeEfficiency = battery.dischargeEff > 0 ? battery.dischargeEff : params.batteryDischargeEff;
  const inverterEfficiency = inverter.efficiency > 0 ? inverter.efficiency : params.inverterEfficiency;
  const dcDischargeW = requiredPeakW / Math.max(0.1, dischargeEfficiency * inverterEfficiency);
  const requiredDischargeA = battery.nominalV > 0 ? dcDischargeW / battery.nominalV : 0;
  const bounds = [
    Math.ceil((requiredContinuousW * 1.1) / inverter.ratedW),
    inverter.surgeW > 0 ? Math.ceil(requiredPeakW / inverter.surgeW) : 1,
    Math.ceil(targetPvW / inverter.maxPvInputW),
    inverter.maxDischargeA > 0 && requiredDischargeA > 0
      ? Math.ceil(requiredDischargeA / inverter.maxDischargeA)
      : 1,
  ];
  return Math.max(1, ...bounds.filter(Number.isFinite));
}

function hasDeclaredLoad(household: HouseholdProfile): boolean {
  return household.appliances.some((appliance) =>
    appliance.quantity > 0 && appliance.hoursPerDay > 0 && appliance.powerW > 0,
  ) || household.activities.some((activity) =>
    activity.enabled && activity.powerW > 0 && activity.durationMinutes > 0,
  );
}

function addCookingToSizingEnergy(
  energy: EnergyBreakdown,
  household: HouseholdProfile,
  params: DesignParams,
): { energy: EnergyBreakdown; cookingKwh: number; cookingNightKwh: number } {
  const enabled = household.cooking.enabled
    ? household.activities.filter((activity) => activity.enabled && activity.powerW > 0 && activity.durationMinutes > 0)
    : [];
  const cookingKwh = enabled.reduce(
    (sum, activity) => sum + activity.powerW * activity.durationMinutes / 60 / 1000,
    0,
  );
  const cookingNightKwh = enabled.reduce((sum, activity) => {
    const isNight = isWithinWindow(activity.mealHour, params.nightStart, params.nightEnd);
    return sum + (isNight ? activity.powerW * activity.durationMinutes / 60 / 1000 : 0);
  }, 0);
  // Las comidas son actividades distintas y normalmente se preparan una a
  // una. Se añade la mayor potencia individual a la punta de la vivienda,
  // en vez de sumar desayuno + almuerzo + cena como si ocurrieran a la vez.
  // La simulación horaria posterior comprueba la coincidencia real con otras cargas.
  const maxCookingPowerW = enabled.reduce((max, activity) => Math.max(max, activity.powerW), 0);

  return {
    cookingKwh,
    cookingNightKwh,
    energy: {
      ...energy,
      dailyKwh: energy.dailyKwh + cookingKwh,
      dayKwh: energy.dayKwh + cookingKwh - cookingNightKwh,
      nightKwh: energy.nightKwh + cookingNightKwh,
      peakSimultaneousW: energy.peakSimultaneousW + maxCookingPowerW,
      averageW: energy.averageW + (cookingKwh * 1000) / 24,
    },
  };
}

function optionPrice(
  panel: PanelSpec,
  panelCount: number,
  battery: BatterySpec,
  batteryCount: number,
  inverter: InverterSpec,
  inverterCount: number,
): { estimatedPrice?: number; currency?: 'USD' | 'CUP' } {
  const prices = [panel.price, battery.price, inverter.price];
  const currencies = [panel.currency, battery.currency, inverter.currency];
  if (prices.some((price) => price === undefined) || currencies.some((currency) => currency === undefined)) return {};
  if (currencies.some((currency) => currency !== currencies[0])) return {};
  return {
    estimatedPrice: panelCount * (panel.price ?? 0) + batteryCount * (battery.price ?? 0) + (inverter.price ?? 0) * inverterCount,
    currency: currencies[0],
  };
}

interface RecommendationCandidate {
  panel: PanelSpec;
  panelCount: number;
  battery: BatterySpec;
  batteryCount: number;
  inverter: InverterSpec;
  inverterCount: number;
  targetBatteryKwh: number;
  targetPvW: number;
  requiredPeakW: number;
  technicalStatus: 'verified' | 'partial';
}

function candidateScore(candidate: RecommendationCandidate): number {
  const installedBatteryKwh = candidate.battery.nominalKwh * candidate.batteryCount;
  const installedPvW = candidate.panel.powerW * candidate.panelCount;
  const inverterW = candidate.inverter.ratedW * candidate.inverterCount;
  const batteryRatio = candidate.targetBatteryKwh > 0
    ? installedBatteryKwh / candidate.targetBatteryKwh
    : installedBatteryKwh;
  const pvRatio = candidate.targetPvW > 0
    ? installedPvW / candidate.targetPvW
    : installedPvW / 1000;
  const inverterRatio = candidate.requiredPeakW > 0
    ? inverterW / candidate.requiredPeakW
    : inverterW / 1000;
  return batteryRatio * 3 + pvRatio * 2 + inverterRatio;
}

function sortCandidates(candidates: RecommendationCandidate[]): RecommendationCandidate[] {
  const referenceCount = (item: RecommendationCandidate) =>
    Number(Boolean(item.panel.isReference)) +
    Number(Boolean(item.battery.isReference)) +
    Number(Boolean(item.inverter.isReference));
  return [...candidates].sort((a, b) => {
    // Primero el tamaño total instalado; la calidad técnica desempata.
    const capacityDifference = candidateScore(a) - candidateScore(b);
    if (Math.abs(capacityDifference) > 1e-9) return capacityDifference;
    if (a.technicalStatus !== b.technicalStatus) {
      return a.technicalStatus === 'verified' ? -1 : 1;
    }
    const references = referenceCount(a) - referenceCount(b);
    if (references !== 0) return references;
    return a.panel.id.localeCompare(b.panel.id) ||
      a.battery.id.localeCompare(b.battery.id) ||
      a.inverter.id.localeCompare(b.inverter.id) ||
      a.inverterCount - b.inverterCount;
  });
}

/**
 * Búsqueda en dos fases:
 * 1) genera y filtra candidatos mediante límites físicos y comprobaciones
 *    técnicas baratas; conserva el menor campo PV de cada combinación.
 * 2) ordena por exceso de capacidad y simula candidatos en ese orden. Sólo
 *    se simula el comportamiento habitual (25 escenarios), y se detiene en
 *    la primera combinación que cumple exactamente el criterio de Result.tsx.
 */

export function generateSolarRecommendations(
  input: RecommendationInput,
  options: RecommendationGenerationOptions = {},
): RecommendationCard[] {
  const arrayCheckCache = new Map<string, BalancedArrayConfigurationCheck>();
  const cards: RecommendationCard[] = [];
  for (const tier of RECOMMENDATION_TIERS) {
    options.onProgress?.({
      tierId: tier.id,
      phase: 'preparing',
      candidatesGenerated: 0,
      candidatesValidated: 0,
      scenariosEvaluated: 0,
    });
    const scenarioHousehold = householdForRecommendation(input.household, tier.id);
    const energy = analyzeEnergy(scenarioHousehold.appliances, input.params);
    const sizing = addCookingToSizingEnergy(energy, scenarioHousehold, input.params);
    const recommendation = findTierRecommendation({
      ...input,
      tier,
      scenarioHousehold,
      energy,
      sizingEnergy: sizing.energy,
    }, options, arrayCheckCache);

    let reason: string | null = null;
    if (!hasDeclaredLoad(scenarioHousehold)) {
      reason = tier.id === 'essential'
        ? 'No hay equipos críticos ni marcados como imprescindibles de noche. Revisa las prioridades de tu vivienda para generar esta opción.'
        : tier.id === 'moderate'
          ? 'No hay equipos con prioridad crítica o importante. Ajusta las prioridades de tu vivienda para generar esta opción.'
          : 'Esta vivienda todavía no tiene consumos suficientes para dimensionar una instalación.';
    } else if (!recommendation) {
      reason = 'No se encontró una combinación viable dentro de los límites residenciales: máximo 10 baterías y 50 paneles; el banco nominal debe ser mayor que un tercio de la energía nocturna y no superar el doble. Sólo se consideran unidades paralelas declaradas por el fabricante. Cada candidata debe alcanzar cobertura mínima del 99,9 %, SOC sostenible en los 24 escenarios y ninguna comida eléctrica sin atender.';
    }
    const card = { tier, recommendation, reason };
    cards.push(card);
    options.onTierComplete?.(card);
  }
  return cards;
}
