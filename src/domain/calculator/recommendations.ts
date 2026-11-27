import type {
  BatterySpec,
  DesignParams,
  InverterSpec,
  PanelSpec,
} from '../core/types';
import type { HouseholdProfile } from '../household/types';
import { effectivePriority } from '../household/types';
import { analyzeEnergy, peakDesignW, type EnergyBreakdown } from './energy';
import { batteryCountFor, requiredBatteryNominalKwh } from './battery';
import { requiredPvWatts } from './sizing';
import { checkInverterCompatibility } from './inverter';
import { checkBalancedArrayConfiguration } from './pv';
import { buildEnergySystemConfig } from '../simulator/bridge';
import { simulate } from '../simulator/engine';
import { intervalCount } from './energy';
import { uid } from '../persistence/storage';
import type { SystemConfiguration } from '../system/types';

export type RecommendationTierId = 'essential' | 'moderate' | 'roomy';

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
  simulatedDemandKwh: number;
  simulatedPvKwh: number;
  finalSoc: number;
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
  appliances: HouseholdProfile['appliances'];
  activities: HouseholdProfile['activities'];
  energy: EnergyBreakdown;
}

const FULL_SOC_TOLERANCE = 0.999;
const ENERGY_TOLERANCE_KWH = 1e-6;
const MAX_PANEL_COUNT = 200;
const MAX_BATTERY_COUNT = 100;
const EXTRA_BATTERY_MODULES_TO_TRY = 4;

function activitiesForTier(
  household: HouseholdProfile,
  tier: RecommendationTierId,
): HouseholdProfile['activities'] {
  if (!household.cooking.enabled) return [];
  return household.activities.filter((activity) => {
    if (!activity.enabled) return false;
    return tier === 'essential' ? activity.essential : true;
  });
}

function appliancesForTier(
  household: HouseholdProfile,
  tier: RecommendationTierId,
): HouseholdProfile['appliances'] {
  return household.appliances
    .filter((appliance) => {
      const priority = effectivePriority(appliance, household.night);
      if (tier === 'essential') {
        return priority === 'critical' || household.night.essentialIds.includes(appliance.id);
      }
      if (tier === 'moderate') return priority !== 'discretionary';
      return true;
    })
    .map((appliance) => ({
      ...appliance,
      priority: effectivePriority(appliance, household.night),
    }));
}

function hasDeclaredLoad(
  appliances: HouseholdProfile['appliances'],
  activities: HouseholdProfile['activities'],
): boolean {
  return appliances.some((appliance) => appliance.quantity > 0 && appliance.hoursPerDay > 0 && appliance.powerW > 0) ||
    activities.some((activity) => activity.enabled && activity.powerW > 0 && activity.durationMinutes > 0);
}

function buildScenarioHousehold(
  household: HouseholdProfile,
  appliances: HouseholdProfile['appliances'],
  activities: HouseholdProfile['activities'],
): HouseholdProfile {
  const includedIds = new Set(appliances.map((appliance) => appliance.id));
  return {
    ...household,
    appliances,
    activities,
    night: {
      essentialIds: household.night.essentialIds.filter((id) => includedIds.has(id)),
    },
  };
}

function optionPrice(
  panel: PanelSpec,
  panelCount: number,
  battery: BatterySpec,
  batteryCount: number,
  inverter: InverterSpec,
): { price?: number; currency?: 'USD' | 'CUP' } {
  const prices = [panel.price, battery.price, inverter.price];
  const currencies = [panel.currency, battery.currency, inverter.currency];
  if (prices.some((price) => price === undefined) || currencies.some((currency) => currency === undefined)) return {};
  if (currencies.some((currency) => currency !== currencies[0])) return {};
  return {
    price: panelCount * (panel.price ?? 0) + batteryCount * (battery.price ?? 0) + (inverter.price ?? 0),
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
  const inverterExcess = candidate.inverter.ratedW > 0
    ? (candidate.inverter.ratedW - candidate.simulatedDemandKwh * 1000 / 24) / candidate.inverter.ratedW
    : 1;
  return batteryExcess * 3 + pvExcess * 2 + inverterExcess;
}

function isUnfixableInverterError(codes: string[]): boolean {
  return codes.some((code) =>
    !['BATT_DISCHARGE_W', 'MPPT', 'PV_INPUT'].includes(code),
  );
}

function findTierRecommendation(input: CandidateSearchInput): SolarRecommendation | null {
  const { household, tier, appliances, activities, energy, params } = input;
  if (!hasDeclaredLoad(appliances, activities)) return null;

  const demandPeakW = energy.peakSimultaneousW;
  const demandSurgeW = peakDesignW(energy);
  const scenarioHousehold = buildScenarioHousehold(household, appliances, activities);
  const gridAvailable = new Array<boolean>(intervalCount(params)).fill(false);
  const candidates: SolarRecommendation[] = [];

  const panels = [...input.panels]
    .filter((panel) => panel.powerW > 0)
    .sort((a, b) => b.powerW - a.powerW);
  const batteries = [...input.batteries]
    .filter((battery) => battery.nominalKwh > 0 && battery.nominalV > 0)
    .sort((a, b) => b.nominalKwh - a.nominalKwh);
  const inverters = [...input.inverters]
    .filter((inverter) => inverter.ratedW > 0 && inverter.maxPvInputW > 0)
    .sort((a, b) => a.ratedW - b.ratedW);

  for (const battery of batteries) {
    const baseBatteryKwh = requiredBatteryNominalKwh(energy, params, battery);
    const targetBatteryKwh = baseBatteryKwh * tier.batteryMargin;
    const firstBatteryCount = Math.max(1, batteryCountFor(targetBatteryKwh, battery));
    const lastBatteryCount = Math.min(
      MAX_BATTERY_COUNT,
      firstBatteryCount + EXTRA_BATTERY_MODULES_TO_TRY,
    );

    for (const inverter of inverters) {
      const designContinuousW = demandPeakW * tier.inverterMargin;
      let foundForPair = false;

      for (const panel of panels) {
        const targetPvW = requiredPvWatts(energy, params, battery);
        const desiredPanelCount = Math.max(1, Math.ceil(targetPvW / panel.powerW));
        const maxPanels = Math.min(
          MAX_PANEL_COUNT,
          Math.floor(inverter.maxPvInputW / panel.powerW),
        );
        if (maxPanels < desiredPanelCount) {
          // Se prueba el máximo admitido: si no recarga completamente, este
          // inversor no puede resolver el déficit con este panel.
        }
        if (maxPanels < 1) continue;

        for (let batteryCount = firstBatteryCount; batteryCount <= lastBatteryCount; batteryCount += 1) {
          const firstPanelCount = Math.min(desiredPanelCount, maxPanels);
          let retryWithMoreBattery = false;

          for (let panelCount = firstPanelCount; panelCount <= maxPanels; panelCount += 1) {
            const technical = checkInverterCompatibility({
              inverter,
              battery,
              panel,
              panelCount,
              batteryCount,
              continuousW: designContinuousW,
              peakW: demandSurgeW,
              voltage: household.voltage,
              params,
            });
            const errorCodes = technical.diagnostics
              .filter((diagnostic) => diagnostic.level === 'error')
              .map((diagnostic) => diagnostic.code);

            if (errorCodes.length > 0) {
              if (errorCodes.includes('BATT_DISCHARGE_W') &&
                  errorCodes.every((code) => code === 'BATT_DISCHARGE_W')) {
                retryWithMoreBattery = true;
                break;
              }
              if (isUnfixableInverterError(errorCodes)) break;
              // Una configuración de strings puede no ser posible para un
              // número concreto de paneles; se prueba el siguiente entero.
              if (errorCodes.includes('MPPT')) continue;
              if (errorCodes.includes('PV_INPUT')) break;
              break;
            }

            const system: SystemConfiguration = {
              id: uid('recommendation-check'),
              householdProfileId: household.id,
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
            const simulation = simulate(config, {
              startHour: 18,
              startSoc: 1,
              cooking: {
                activities,
                mode: 'usual',
                substitution: household.cooking.substitution,
                hasFuel: household.cooking.fuelKind !== null && household.cooking.fuelConfirmed,
              },
            });

            const fullyRecharged = simulation.totals.finalSoc >= FULL_SOC_TOLERANCE;
            const noUnservedEnergy = simulation.totals.unservedKwh <= ENERGY_TOLERANCE_KWH;
            if (!simulation.valid || !fullyRecharged || !noUnservedEnergy) continue;

            const arrayCheck = checkBalancedArrayConfiguration(panel, inverter, panelCount, params);
            const warnings: string[] = [];
            if (technical.status === 'partial' || arrayCheck.status === 'insufficient') {
              warnings.push('La simulación energética cumple, pero algunos datos eléctricos del catálogo no permiten verificar toda la conexión. Confirma las fichas técnicas antes de comprar.');
            }
            if (panel.isReference || battery.isReference || inverter.isReference) {
              warnings.push('La combinación incluye al menos un equipo de referencia. Sustituye sus datos por los de la ficha técnica del modelo que vayas a comprar.');
            }
            if (simulation.totals.cookingMealsSubstituted > 0) {
              warnings.push('La recarga se ha comprobado respetando el uso de combustible alternativo declarado para algunas comidas.');
            }
            if (panelCount * panel.powerW + 1e-6 < targetPvW) {
              warnings.push('La potencia fotovoltaica instalada queda por debajo de la estimación inicial; la simulación horaria sí alcanza el SOC de partida bajo las hipótesis solares configuradas.');
            }

            const price = optionPrice(panel, panelCount, battery, batteryCount, inverter);
            candidates.push({
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
              simulatedDemandKwh: simulation.totals.demandKwh,
              simulatedPvKwh: simulation.totals.pvProducedKwh,
              finalSoc: simulation.totals.finalSoc,
              unservedKwh: simulation.totals.unservedKwh,
              technicalStatus: technical.status,
              warnings,
              ...price,
            });
            foundForPair = true;
            break;
          }

          if (foundForPair) break;
          if (!retryWithMoreBattery && batteryCount === firstBatteryCount) {
            // Si no hay una incompatibilidad de potencia de descarga que
            // pueda corregirse añadiendo módulos, los demás bancos no ayudan.
            const minimalCheck = checkInverterCompatibility({
              inverter,
              battery,
              panel,
              panelCount: Math.min(desiredPanelCount, maxPanels),
              batteryCount,
              continuousW: designContinuousW,
              peakW: demandSurgeW,
              voltage: household.voltage,
              params,
            });
            const hardErrors = minimalCheck.diagnostics
              .filter((diagnostic) => diagnostic.level === 'error')
              .map((diagnostic) => diagnostic.code)
              .filter((code) => code !== 'BATT_DISCHARGE_W');
            if (hardErrors.length > 0) break;
          }
        }
        if (foundForPair) break;
      }
      if (foundForPair) break;
    }
    if (candidates.length > 0) break;
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.currency && b.currency && a.currency === b.currency &&
        a.estimatedPrice !== undefined && b.estimatedPrice !== undefined) {
      return a.estimatedPrice - b.estimatedPrice;
    }
    if (a.technicalStatus !== b.technicalStatus) {
      return a.technicalStatus === 'verified' ? -1 : 1;
    }
    return candidateScore(a) - candidateScore(b);
  });
  return candidates[0];
}

export function generateSolarRecommendations(input: RecommendationInput): RecommendationCard[] {
  return RECOMMENDATION_TIERS.map((tier) => {
    const appliances = appliancesForTier(input.household, tier.id);
    const activities = activitiesForTier(input.household, tier.id);
    const energy = analyzeEnergy(appliances, input.params);
    const recommendation = findTierRecommendation({
      ...input,
      tier,
      appliances,
      activities,
      energy,
    });
    let reason: string | null = null;
    if (!hasDeclaredLoad(appliances, activities)) {
      reason = tier.id === 'essential'
        ? 'No hay equipos críticos ni equipos marcados como imprescindibles de noche. Revisa las prioridades de tu vivienda para generar esta opción.'
        : tier.id === 'moderate'
          ? 'No hay equipos con prioridad crítica o importante. Ajusta las prioridades de tu vivienda para generar esta opción.'
          : 'Esta vivienda todavía no tiene consumos suficientes para dimensionar una instalación.';
    } else if (!recommendation) {
      reason = 'No se encontró una combinación del catálogo que pueda alimentar estas cargas y recuperar al menos el 99,9 % de la carga inicial en 24 horas sin utilizar la red. Revisa las fichas técnicas o amplía el catálogo.';
    }
    return { tier, recommendation, reason };
  });
}
