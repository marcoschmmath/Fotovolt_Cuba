import type {
  BatterySpec,
  DesignParams,
  InverterSpec,
  PanelSpec,
} from '../core/types';
import type { HouseholdProfile } from '../household/types';
import type { SystemConfiguration } from '../system/types';
import { householdForRecommendation, type RecommendationTierId } from '../household/recommendationProfile';
import { analyzeEnergy, intervalCount, isWithinWindow, peakDesignW, type EnergyBreakdown } from './energy';
import { batteryCountFor, batteryPack, requiredBatteryNominalKwh } from './battery';
import { requiredPvWatts } from './sizing';
import { checkInverterCompatibility } from './inverter';
import { checkBalancedArrayConfiguration } from './pv';
import { buildEnergySystemConfig } from '../simulator/bridge';
import { simulate } from '../simulator/engine';

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
  rechargeSoc: number;
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
  sizingEnergy: EnergyBreakdown;
}

const FULL_SOC_TOLERANCE = 0.999;
const ENERGY_TOLERANCE_KWH = 1e-6;
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
  const maxCookingPowerW = enabled.reduce((sum, activity) => sum + activity.powerW, 0);

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
  const { household, tier, scenarioHousehold, params, sizingEnergy } = input;
  if (!hasDeclaredLoad(scenarioHousehold)) return [];

  const requiredContinuousW = sizingEnergy.peakSimultaneousW * tier.inverterMargin;
  const requiredPeakW = peakDesignW(sizingEnergy);
  const gridAvailable = new Array<boolean>(intervalCount(params)).fill(false);
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
        if (maxPanels < desiredPanelCount) {
          // Se permite probar la capacidad PV máxima; la simulación decidirá
          // si ese límite todavía alcanza para restaurar la batería.
        }
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
            const config = buildEnergySystemConfig({
              household: scenarioHousehold,
              system,
              panel,
              battery,
              inverter,
              gridAvailable,
            });
            const initialPack = batteryPack(battery, batteryCount, params);
            const simulation = simulate(config, {
              startHour: config.solar.sunrise,
              startSoc: initialPack.minSoc,
              cooking: {
                activities: scenarioHousehold.activities,
                mode: 'usual',
                substitution: household.cooking.substitution,
                hasFuel: household.cooking.fuelKind !== null && household.cooking.fuelConfirmed,
              },
            });

            const lastSolarInterval = simulation.intervals
              .filter((interval) =>
                interval.hour >= config.solar.sunrise &&
                interval.hour < config.solar.sunset,
              )
              .at(-1);
            const rechargeSoc = lastSolarInterval?.soc ?? initialPack.minSoc;
            if (
              !simulation.valid ||
              rechargeSoc < FULL_SOC_TOLERANCE ||
              simulation.totals.unservedKwh > ENERGY_TOLERANCE_KWH
            ) continue;

            const warnings: string[] = [];
            if (technical.status === 'partial' || arrayCheck.status === 'insufficient') {
              warnings.push('La simulación energética cumple, pero faltan datos de ficha para verificar completamente la conexión eléctrica. Confirma estos parámetros antes de comprar.');
            }
            if (panel.isReference || battery.isReference || inverter.isReference) {
              warnings.push('La combinación incluye al menos un equipo de referencia. Sustituye sus datos por los de la ficha técnica del modelo que vayas a comprar.');
            }
            if (simulation.totals.cookingMealsSubstituted > 0) {
              warnings.push('La simulación respeta el combustible alternativo declarado para algunas comidas.');
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
              simulatedDemandKwh: simulation.totals.demandKwh,
              simulatedPvKwh: simulation.totals.pvProducedKwh,
              rechargeSoc,
              unservedKwh: simulation.totals.unservedKwh,
              technicalStatus: technical.status,
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
      reason = 'No se encontró una combinación del catálogo que cubra las cargas y recupere al menos el 99,9 % de la carga inicial en 24 horas, sin utilizar la red. Revisa las fichas técnicas o amplía el catálogo.';
    }
    return { tier, recommendation, reason };
  });
}
