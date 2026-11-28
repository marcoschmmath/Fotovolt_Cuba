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
import { checkInverterCompatibility, inverterWithParallelUnits } from './inverter';
import { evaluateSystemBehavior } from '../simulator/scenarioGrid';

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
function findTierRecommendation(input: CandidateSearchInput): SolarRecommendation | null {
  const { household, tier, scenarioHousehold, params, energy, sizingEnergy } = input;
  if (!hasDeclaredLoad(scenarioHousehold)) return null;

  const requiredContinuousW = energy.peakSimultaneousW * tier.inverterMargin;
  const requiredPeakW = peakDesignW(energy);
  const nightEnergyKwh = Math.max(0, sizingEnergy.nightKwh);

  const panels = input.panels
    .filter((panel) => panel.powerW > 0)
    .sort((a, b) => b.powerW - a.powerW);
  const batteries = input.batteries
    .filter((battery) => battery.nominalKwh > 0 && battery.nominalV > 0)
    .sort((a, b) => a.nominalKwh - b.nominalKwh);
  const inverters = input.inverters
    .filter((inverter) => inverter.ratedW > 0 && inverter.maxPvInputW > 0)
    .sort((a, b) => a.ratedW - b.ratedW);

  // FASE 1A: descartar baterías y cantidades fuera del intervalo solicitado.
  // Para E_n > 0: E_n/3 < C_banco <= 2 E_n. Sin consumo nocturno se prueba
  // únicamente un módulo, evitando inventar una necesidad de almacenamiento.
  const batteryOptions = batteries.flatMap((battery) => {
    const targetBatteryKwh = requiredBatteryNominalKwh(sizingEnergy, params, battery) * tier.batteryMargin;
    const targetPvW = requiredPvWatts(sizingEnergy, params, battery);
    const options: Array<{ battery: BatterySpec; batteryCount: number; targetBatteryKwh: number; targetPvW: number }> = [];
    for (let batteryCount = 1; batteryCount <= MAX_BATTERY_COUNT; batteryCount += 1) {
      const bankKwh = battery.nominalKwh * batteryCount;
      if (!batteryBankFitsNightEnergy(nightEnergyKwh, bankKwh)) continue;
      if (nightEnergyKwh <= 0 && batteryCount > 1) continue;
      options.push({ battery, batteryCount, targetBatteryKwh, targetPvW });
    }
    return options;
  });
  if (!batteryOptions.length) return null;

  // FASE 1B: crear las configuraciones posibles de inversores. La capacidad
  // paralela sólo existe cuando el catálogo la declara expresamente.
  const inverterOptions = inverters.flatMap((inverter) => {
    const maxUnits = Math.max(1, Math.floor(inverter.maxParallelUnits ?? 1));
    return Array.from({ length: maxUnits }, (_, index) => {
      const inverterCount = index + 1;
      return {
        inverter,
        inverterCount,
        effective: inverterWithParallelUnits(inverter, inverterCount),
      };
    });
  });

  // FASE 1C: generación técnica. No se ejecuta todavía el simulador.
  const candidates: RecommendationCandidate[] = [];
  for (const batteryOption of batteryOptions) {
    const { battery, batteryCount, targetBatteryKwh, targetPvW } = batteryOption;
    for (const inverterOption of inverterOptions) {
      const { inverter, inverterCount, effective } = inverterOption;
      // La capacidad continua y de arranque crece con las unidades paralelas.
      if (effective.ratedW < requiredContinuousW * 1.1) continue;
      if (effective.surgeW > 0 && effective.surgeW < requiredPeakW) continue;
      const voltageDifference = Math.abs(battery.nominalV - effective.batteryVoltageV);
      if (effective.batteryVoltageV > 0 && voltageDifference > 5 &&
          voltageDifference / effective.batteryVoltageV > 0.12) continue;

      for (const panel of panels) {
        const desiredPanelCount = Math.max(1, Math.ceil(targetPvW / panel.powerW));
        const maxPanels = Math.min(MAX_PANEL_COUNT, Math.floor(effective.maxPvInputW / panel.powerW));
        if (desiredPanelCount > maxPanels) continue;

        // El primer número técnicamente admisible es el menor campo solar
        // para este conjunto de equipos; añadir paneles no mejora su tamaño.
        for (let panelCount = desiredPanelCount; panelCount <= maxPanels; panelCount += 1) {
          const technical = checkInverterCompatibility({
            inverter: effective,
            battery,
            panel,
            panelCount,
            batteryCount,
            continuousW: requiredContinuousW,
            peakW: requiredPeakW,
            voltage: household.voltage,
            params,
          });
          if (!technical.compatible) {
            const errors = technical.diagnostics.filter((item) => item.level === 'error');
            // MPPT depende del número entero de paneles; otros errores
            // (potencia, tensión, descarga) no se arreglan añadiendo paneles.
            if (errors.some((item) => item.code === 'MPPT') &&
                errors.every((item) => item.code === 'MPPT')) continue;
            break;
          }
          candidates.push({
            panel, panelCount, battery, batteryCount, inverter, inverterCount,
            targetBatteryKwh, targetPvW, requiredPeakW, technicalStatus: technical.status,
          });
          break;
        }
      }
    }
  }

  // FASE 2: valida en orden de menor exceso de capacidad. La evaluación
  // oficial conserva 08:00, SOC inicial max(30 %, SOC mínimo), los 24 horarios
  // normales y el criterio exacto de compatibilidad. No calcula flexible.
  for (const candidate of sortCandidates(candidates)) {
    const {
      panel, panelCount, battery, batteryCount, inverter, inverterCount,
      targetBatteryKwh, targetPvW, requiredPeakW, technicalStatus,
    } = candidate;
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
      inverterCount,
      installationType: 'hybrid',
      params,
      origin: 'user',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const usual = evaluateSystemBehavior({
      household: scenarioHousehold, system, panel, battery, inverter,
    }, 'usual');
    const energyCompatible =
      usual.coverageWorst >= 0.999 &&
      usual.energySustainable &&
      usual.cookingMealsUnmetWorst === 0;
    if (!energyCompatible) continue;

    const warnings: string[] = [];
    if (technicalStatus === 'partial') {
      warnings.push('La simulación energética cumple, pero faltan datos de ficha para verificar completamente la conexión eléctrica. Confirma estos parámetros antes de comprar.');
    }
    if (panel.isReference || battery.isReference || inverter.isReference) {
      warnings.push('La combinación incluye al menos un equipo de referencia. Sustituye sus datos por los de la ficha técnica del modelo que vayas a comprar.');
    }
    if (inverterCount > 1) {
      warnings.push(`La propuesta utiliza ${inverterCount} inversores idénticos en paralelo. Requiere el kit/cableado de comunicación, banco común de baterías y distribución fotovoltaica independiente por inversor según el manual del fabricante.`);
    }
    if (usual.scenarios.some((scenario) => scenario.cookingMealsSubstituted > 0)) {
      warnings.push('La evaluación usual utiliza el combustible alternativo declarado para algunas comidas, tal como está configurado en el perfil de vivienda.');
    }
    const price = optionPrice(panel, panelCount, battery, batteryCount, inverter, inverterCount);
    return {
      tier: tier.id,
      label: tier.label,
      description: tier.description,
      panel,
      panelCount,
      battery,
      batteryCount,
      inverter,
      inverterCount,
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
      technicalStatus,
      warnings,
      ...price,
    };
  }
  return null;
}

export function generateSolarRecommendations(input: RecommendationInput): RecommendationCard[] {
  return RECOMMENDATION_TIERS.map((tier) => {
    const scenarioHousehold = householdForRecommendation(input.household, tier.id);
    const energy = analyzeEnergy(scenarioHousehold.appliances, input.params);
    const sizing = addCookingToSizingEnergy(energy, scenarioHousehold, input.params);
    const recommendation = findTierRecommendation({
      ...input,
      tier,
      scenarioHousehold,
      energy,
      sizingEnergy: sizing.energy,
    });

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
