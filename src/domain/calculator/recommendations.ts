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
import { batteryCountFor, requiredBatteryNominalKwh } from './battery';
import { requiredPvWatts } from './sizing';
import { checkInverterCompatibility } from './inverter';
import { checkBalancedArrayConfiguration } from './pv';
import { evaluateSystem } from '../simulator/scenarioGrid';

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

interface CandidateSearchInput extends RecommendationInput {
  tier: RecommendationTier;
  scenarioHousehold: HouseholdProfile;
  /** Demanda de electrodomésticos, igual que la que usa Result.tsx en el chequeo técnico. */
  energy: EnergyBreakdown;
  /** Demanda diaria incluyendo las actividades de cocina para dimensionar energía. */
  sizingEnergy: EnergyBreakdown;
}

const MAX_PANEL_COUNT = 200;
const MAX_BATTERY_COUNT = 100;
const EXTRA_BATTERY_MODULES_TO_TRY = 3;

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
): { estimatedPrice?: number; currency?: 'USD' | 'CUP' } {
  const prices = [panel.price, battery.price, inverter.price];
  const currencies = [panel.currency, battery.currency, inverter.currency];
  if (prices.some((price) => price === undefined) || currencies.some((currency) => currency === undefined)) return {};
  if (currencies.some((currency) => currency !== currencies[0])) return {};
  return {
    estimatedPrice: panelCount * (panel.price ?? 0) + batteryCount * (battery.price ?? 0) + (inverter.price ?? 0),
    currency: currencies[0],
  };
}

function candidateScore(candidate: SolarRecommendation): number {
  const batteryExcess = candidate.targetBatteryKwh > 0
    ? (candidate.installedBatteryKwh - candidate.targetBatteryKwh) / candidate.targetBatteryKwh
    : candidate.installedBatteryKwh;
  const pvExcess = candidate.targetPvW > 0
    ? (candidate.installedPvW - candidate.targetPvW) / candidate.targetPvW
    : candidate.installedPvW / 1000;
  const inverterExcess = candidate.requiredPeakW > 0
    ? (candidate.inverter.ratedW - candidate.requiredPeakW) / candidate.requiredPeakW
    : 0;
  return batteryExcess * 3 + pvExcess * 2 + inverterExcess;
}

function sortCandidates(candidates: SolarRecommendation[]): SolarRecommendation[] {
  return [...candidates].sort((a, b) => {
    const referenceCount = (item: SolarRecommendation) =>
      Number(Boolean(item.panel.isReference)) +
      Number(Boolean(item.battery.isReference)) +
      Number(Boolean(item.inverter.isReference));
    const referenceDifference = referenceCount(a) - referenceCount(b);
    if (referenceDifference !== 0) return referenceDifference;
    if (a.technicalStatus !== b.technicalStatus) {
      return a.technicalStatus === 'verified' ? -1 : 1;
    }
    if (
      a.currency && b.currency &&
      a.currency === b.currency &&
      a.estimatedPrice !== undefined &&
      b.estimatedPrice !== undefined
    ) {
      return a.estimatedPrice - b.estimatedPrice;
    }
    return candidateScore(a) - candidateScore(b);
  });
}

function findTierRecommendations(input: CandidateSearchInput): SolarRecommendation[] {
  const { household, tier, scenarioHousehold, params, energy, sizingEnergy } = input;
  if (!hasDeclaredLoad(scenarioHousehold)) return [];

  const requiredContinuousW = energy.peakSimultaneousW * tier.inverterMargin;
  const requiredPeakW = peakDesignW(energy);
  const recommendations: SolarRecommendation[] = [];

  const panels = input.panels
    .filter((panel) => panel.powerW > 0)
    .sort((a, b) => b.powerW - a.powerW);
  const batteries = input.batteries
    .filter((battery) => battery.nominalKwh > 0 && battery.nominalV > 0)
    .sort((a, b) => a.nominalKwh - b.nominalKwh);
  const inverters = input.inverters
    .filter((inverter) => inverter.ratedW > 0 && inverter.maxPvInputW > 0)
    .sort((a, b) => a.ratedW - b.ratedW);

  for (const battery of batteries) {
    const targetBatteryKwh = requiredBatteryNominalKwh(sizingEnergy, params, battery) * tier.batteryMargin;
    const firstBatteryCount = Math.max(1, batteryCountFor(targetBatteryKwh, battery));
    const lastBatteryCount = Math.min(MAX_BATTERY_COUNT, firstBatteryCount + EXTRA_BATTERY_MODULES_TO_TRY);
    const targetPvW = requiredPvWatts(sizingEnergy, params, battery);

    inverterLoop: for (const inverter of inverters) {
      // Potencia y arranque del inversor no se solucionan añadiendo batería o placas.
      if (inverter.ratedW < requiredContinuousW * 1.1 || inverter.surgeW > 0 && inverter.surgeW < requiredPeakW) continue;
      if (battery.nominalV > 0 && inverter.batteryVoltageV > 0) {
        const difference = Math.abs(battery.nominalV - inverter.batteryVoltageV);
        if (difference > 5 && difference / inverter.batteryVoltageV > 0.12) continue;
      }

      for (const panel of panels) {
        const desiredPanelCount = Math.max(1, Math.ceil(targetPvW / panel.powerW));
        const maxPanels = Math.min(MAX_PANEL_COUNT, Math.floor(inverter.maxPvInputW / panel.powerW));
        if (maxPanels < 1) continue;

        let foundForPanel = false;
        for (let batteryCount = firstBatteryCount; batteryCount <= lastBatteryCount; batteryCount += 1) {
          for (let panelCount = Math.min(desiredPanelCount, maxPanels); panelCount <= maxPanels; panelCount += 1) {
            const technical = checkInverterCompatibility({
              inverter,
              battery,
              panel,
              panelCount,
              batteryCount,
              continuousW: requiredContinuousW,
              peakW: requiredPeakW,
              voltage: household.voltage,
              params,
            });
            const errorCodes = technical.diagnostics
              .filter((diagnostic) => diagnostic.level === 'error')
              .map((diagnostic) => diagnostic.code);
            const hardError = errorCodes.some((code) => !['MPPT', 'BATT_DISCHARGE_W'].includes(code));
            if (hardError) continue inverterLoop;
            // El límite de descarga del BMS sí puede corregirse añadiendo
            // módulos en paralelo. Se prueba el siguiente tamaño de banco.
            if (errorCodes.includes('BATT_DISCHARGE_W')) break;
            // Una configuración de strings puede depender del número entero
            // de paneles; se prueba el siguiente tamaño del campo PV.
            if (errorCodes.includes('MPPT')) continue;

            const arrayCheck = checkBalancedArrayConfiguration(panel, inverter, panelCount, params);
            if (arrayCheck.status === 'incompatible') continue;

            const system: SystemConfiguration = {
              id: 'recommendation-preview',
              householdProfileId: household.id,
              recommendationTier: tier.id,
              name: 'Comprobación automática',
              panelId: panel.id,
              panelCount,
              batteryId: battery.id,
              batteryCount,
              inverterId: inverter.id,
              installationType: 'hybrid',
              params,
              origin: 'user',
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
            };
            // Reutiliza el evaluador oficial de la app. Éste ejecuta los 24
            // escenarios de retorno de red y el apagón total, siempre desde
            // las 08:00 y con el SOC inicial max(30 %, SOC mínimo físico).
            // El criterio normal es exactamente el de Result.tsx.
            const evaluation = evaluateSystem({
              household: scenarioHousehold,
              system,
              panel,
              battery,
              inverter,
            });
            const usual = evaluation.behaviors.usual;
            const energyCompatible =
              usual.coverageWorst >= 0.999 &&
              usual.energySustainable &&
              usual.cookingMealsUnmetWorst === 0;
            if (!energyCompatible) continue;

            const warnings: string[] = [];
            if (technical.status === 'partial' || arrayCheck.status === 'insufficient') {
              warnings.push('La simulación energética cumple, pero faltan datos de ficha para verificar completamente la conexión eléctrica. Confirma estos parámetros antes de comprar.');
            }
            if (panel.isReference || battery.isReference || inverter.isReference) {
              warnings.push('La combinación incluye al menos un equipo de referencia. Sustituye sus datos por los de la ficha técnica del modelo que vayas a comprar.');
            }
            if (usual.scenarios.some((scenario) => scenario.cookingMealsSubstituted > 0)) {
              warnings.push('La evaluación usual utiliza el combustible alternativo declarado para algunas comidas, tal como está configurado en el perfil de vivienda.');
            }

            const price = optionPrice(panel, panelCount, battery, batteryCount, inverter);
            recommendations.push({
              tier: tier.id,
              label: tier.label,
              description: tier.description,
              panel,
              panelCount,
              battery,
              batteryCount,
              inverter,
              installedPvW: panelCount * panel.powerW,
              installedBatteryKwh: batteryCount * battery.nominalKwh,
              targetBatteryKwh,
              targetPvW,
              requiredPeakW,
              simulatedDemandKwh: sizingEnergy.dailyKwh,
              simulatedPvKwh: usual.pvKwhMedian,
              initialSoc: usual.initialSoc,
              finalSocWorst: Math.min(...usual.scenarios.map((scenario) => scenario.finalSoc), 1),
              coverageWorst: usual.coverageWorst,
              energySustainable: usual.energySustainable,
              cookingMealsUnmetWorst: usual.cookingMealsUnmetWorst,
              blackoutCoverage: usual.blackout.coverage,
              blackoutUnservedKwh: usual.blackout.unservedKwh,
              unservedKwh: usual.unservedKwhWorst,
              technicalStatus: technical.status === 'verified' ? 'verified' : 'partial',
              warnings,
              ...price,
            });
            // Para esta combinación, más paneles no mejoran la viabilidad y
            // sólo aumentan el tamaño/coste. Se busca otro conjunto de equipos.
            foundForPanel = true;
            break;
          }
          if (foundForPanel) break;
        }
      }
    }
  }

  return sortCandidates(recommendations);
}

export function generateSolarRecommendations(input: RecommendationInput): RecommendationCard[] {
  return RECOMMENDATION_TIERS.map((tier) => {
    const scenarioHousehold = householdForRecommendation(input.household, tier.id);
    const energy = analyzeEnergy(scenarioHousehold.appliances, input.params);
    const sizing = addCookingToSizingEnergy(energy, scenarioHousehold, input.params);
    const recommendation = findTierRecommendations({
      ...input,
      tier,
      scenarioHousehold,
      energy,
      sizingEnergy: sizing.energy,
    })[0] ?? null;

    let reason: string | null = null;
    if (!hasDeclaredLoad(scenarioHousehold)) {
      reason = tier.id === 'essential'
        ? 'No hay equipos críticos ni marcados como imprescindibles de noche. Revisa las prioridades de tu vivienda para generar esta opción.'
        : tier.id === 'moderate'
          ? 'No hay equipos con prioridad crítica o importante. Ajusta las prioridades de tu vivienda para generar esta opción.'
          : 'Esta vivienda todavía no tiene consumos suficientes para dimensionar una instalación.';
    } else if (!recommendation) {
      reason = 'No se encontró una combinación que supere el mismo criterio energético utilizado en Result.tsx: cobertura mínima del 99,9 %, SOC final sostenible en los 24 escenarios de retorno de red y ninguna comida eléctrica sin atender. Revisa las fichas técnicas o amplía el catálogo.';
    }
    return { tier, recommendation, reason };
  });
}
