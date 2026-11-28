import { describe, expect, it } from 'vitest';
import {
  batteryBankFitsNightEnergy,
  generateSolarRecommendations,
  RECOMMENDATION_LIMITS,
  type RecommendationProgress,
} from './recommendations';
import { batteryPack } from './battery';
import type { HouseholdProfile } from '../household/types';
import { DEFAULT_COOKING, defaultCookingActivities } from '../household/types';
import { householdForRecommendation } from '../household/recommendationProfile';
import { evaluateCompatibleSystemBehavior, evaluateSystemBehavior } from '../simulator/scenarioGrid';
import type { SystemConfiguration } from '../system/types';
import { appliance, battery, inverter, panel, params } from '../../test/fixtures';

function household(): HouseholdProfile {
  return {
    id: 'home-recommendation-test',
    name: 'Casa de prueba',
    appliances: [
      appliance({
        id: 'critical-night',
        name: 'Iluminación esencial',
        powerW: 120,
        hoursPerDay: 6,
        schedule: 'night',
        priority: 'critical',
      }),
      appliance({
        id: 'important-day',
        name: 'Ventiladores',
        powerW: 180,
        hoursPerDay: 5,
        schedule: 'day',
        priority: 'important',
      }),
      appliance({
        id: 'optional-day',
        name: 'Televisor adicional',
        powerW: 100,
        hoursPerDay: 4,
        schedule: 'day',
        priority: 'discretionary',
      }),
    ],
    cooking: { ...DEFAULT_COOKING, enabled: false },
    activities: defaultCookingActivities(),
    night: { essentialIds: ['critical-night'] },
    voltage: 220,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('filtros del recomendador', () => {
  it('aplica el intervalo de capacidad del banco entre un tercio y el doble de la energía nocturna', () => {
    expect(batteryBankFitsNightEnergy(5, 1.67)).toBe(true);
    expect(batteryBankFitsNightEnergy(5, 5.12)).toBe(true);
    expect(batteryBankFitsNightEnergy(5, 10)).toBe(true);
    expect(batteryBankFitsNightEnergy(5, 1.66)).toBe(false);
    expect(batteryBankFitsNightEnergy(5, 10.24)).toBe(false);
    expect(batteryBankFitsNightEnergy(5, 15.36)).toBe(false);
  });

  it('limita las sugerencias a 10 baterías y 50 paneles', () => {
    expect(RECOMMENDATION_LIMITS).toEqual({ maxPanels: 50, maxBatteries: 10 });
  });

});

describe('generateSolarRecommendations', () => {
  it('prueba arrays mayores cuando el tamaño FV inicial no sostiene la demanda', () => {
    const source = household();
    source.appliances[0] = appliance({
      id: 'critical-night',
      name: 'Carga nocturna crítica',
      powerW: 500,
      hoursPerDay: 6,
      schedule: 'night',
      priority: 'critical',
    });
    source.appliances[1] = appliance({
      id: 'important-day',
      name: 'Carga diurna',
      powerW: 700,
      hoursPerDay: 4.5,
      schedule: 'day',
      priority: 'important',
    });

    let lastModerateProgress: RecommendationProgress | undefined;
    let lastModerateRejection: string | undefined;
    const result = generateSolarRecommendations({
      household: source,
      panels: [panel()],
      batteries: [battery()],
      inverters: [inverter({
        // Este caso necesita más de 14 módulos para cubrir la primera hora
        // solar. Se usa un inversor de 8 kW con 12 kW de entrada FV para que
        // los arrays mayores que esperamos seleccionar sean admisibles.
        ratedW: 8000,
        surgeW: 16000,
        maxPvInputW: 12000,
        mppt: [
          { minVoltageV: 120, maxVoltageV: 450, maxCurrentA: 40, maxPowerW: 10000 },
          { minVoltageV: 120, maxVoltageV: 450, maxCurrentA: 40, maxPowerW: 10000 },
        ],
      })],
      // Fuerza un objetivo FV inicial inferior a un panel, sin hacer inviable
      // el banco: 5 kWh queda dentro del intervalo permitido para 3 kWh nocturnos.
      params: params({ hsp: 2.5, safetyFactor: 0.01 }),
    }, {
      onProgress: (progress) => {
        if (progress.tierId !== 'moderate') return;
        lastModerateProgress = progress;
        if (progress.lastEnergyRejection) lastModerateRejection = progress.lastEnergyRejection;
      },
    });

    const moderate = result.find((card) => card.tier.id === 'moderate');
    expect(moderate).toBeDefined();

    // Diagnóstico exhaustivo temporal: identifica para cada tamaño de array
    // los escenarios que no alcanzan el 99,9 % y si el déficit afecta a SOC.
    const moderateHousehold = householdForRecommendation(source, 'moderate');
    const debugPanelCounts = [14, 16, 18, 20, 21];
    const simulationDiagnostics = debugPanelCounts.map((panelCount) => {
      const debugSystem: SystemConfiguration = {
        id: `debug-${panelCount}`,
        householdProfileId: source.id,
        recommendationTier: 'moderate',
        name: 'Diagnóstico',
        panelId: panel().id,
        panelCount,
        batteryId: battery().id,
        batteryCount: 1,
        inverterId: inverter().id,
        inverterCount: 1,
        installationType: 'hybrid',
        params: params({ hsp: 2.5, safetyFactor: 0.01 }),
        origin: 'user',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      const outcome = evaluateSystemBehavior({
        household: moderateHousehold,
        system: debugSystem,
        panel: panel(),
        battery: battery(),
        inverter: inverter({
          ratedW: 8000,
          surgeW: 16000,
          maxPvInputW: 12000,
          mppt: [
            { minVoltageV: 120, maxVoltageV: 450, maxCurrentA: 40, maxPowerW: 10000 },
            { minVoltageV: 120, maxVoltageV: 450, maxCurrentA: 40, maxPowerW: 10000 },
          ],
        }),
      }, 'usual');
      return {
        panelCount,
        coverageWorst: outcome.coverageWorst,
        energySustainable: outcome.energySustainable,
        finalSocWorst: Math.min(...outcome.scenarios.map((scenario) => scenario.finalSoc)),
        lowCoverage: outcome.scenarios
          .filter((scenario) => scenario.coverage < 0.999)
          .map((scenario) => ({
            label: scenario.label,
            coverage: scenario.coverage,
            unservedKwh: scenario.unservedKwh,
            unservedCriticalKwh: scenario.unservedCriticalKwh,
            finalSoc: scenario.finalSoc,
            minSoc: scenario.minSoc,
          })),
      };
    });

    expect(
      moderate?.recommendation,
      JSON.stringify({
        progress: lastModerateProgress,
        lastEnergyRejection: lastModerateRejection,
        simulationDiagnostics,
      }),
    ).not.toBeNull();
    expect(moderate!.recommendation!.panelCount).toBeGreaterThan(
      Math.ceil(moderate!.recommendation!.targetPvW / panel().powerW),
    );
  });

  it('genera tres niveles aplicando el criterio de compatibilidad existente (08:00, SOC inicial 30 %)', () => {
    const source = household();
    const completedTiers: string[] = [];
    const progressPhases: string[] = [];
    const result = generateSolarRecommendations({
      household: source,
      panels: [panel()],
      batteries: [battery({ nominalKwh: 1.4 })],
      inverters: [inverter()],
      params: params(),
    }, {
      onProgress: (progress) => progressPhases.push(progress.phase),
      onTierComplete: (card) => completedTiers.push(card.tier.id),
    });

    expect(result.map((card) => card.tier.id)).toEqual(['essential', 'moderate', 'roomy']);
    for (const card of result) {
      expect(card.recommendation).not.toBeNull();
      const recommendation = card.recommendation!;
      expect(recommendation.panel.id).toBe('ref-panel-550');
      expect(recommendation.battery.id).toBe('ref-batt-5');
      expect(recommendation.inverter.id).toBe('ref-inv-5000');
      expect(recommendation.panelCount).toBeGreaterThan(0);
      expect(recommendation.batteryCount).toBeGreaterThan(0);
      const pack = batteryPack(recommendation.battery, recommendation.batteryCount, params());
      expect(recommendation.initialSoc).toBeCloseTo(Math.max(0.30, pack.minSoc), 10);
      expect(recommendation.initialSoc).toBeLessThanOrEqual(1);
      expect(recommendation.coverageWorst).toBeGreaterThanOrEqual(0.999);
      expect(recommendation.energySustainable).toBe(true);
      expect(recommendation.cookingMealsUnmetWorst).toBe(0);
      expect(recommendation.finalSocWorst).toBeGreaterThanOrEqual(recommendation.initialSoc - 0.005);
      expect(recommendation.blackoutCoverage).toBeGreaterThanOrEqual(0);
      expect(recommendation.blackoutCoverage).toBeLessThanOrEqual(1);
    }
    expect(completedTiers).toEqual(['essential', 'moderate', 'roomy']);
    expect(progressPhases).toContain('generating');
    expect(progressPhases).toContain('validating');
    expect(progressPhases).toContain('complete');

    // El camino rápido del recomendador debe devolver las mismas métricas
    // que la evaluación detallada cuando la instalación supera los escenarios.
    const recommendation = result[0].recommendation!;
    const scenarioHousehold = householdForRecommendation(source, recommendation.tier);
    const designParams = params();
    const system: SystemConfiguration = {
      id: 'equivalence-test',
      householdProfileId: source.id,
      recommendationTier: recommendation.tier,
      name: 'Equivalencia',
      panelId: recommendation.panel.id,
      panelCount: recommendation.panelCount,
      batteryId: recommendation.battery.id,
      batteryCount: recommendation.batteryCount,
      inverterId: recommendation.inverter.id,
      inverterCount: recommendation.inverterCount,
      installationType: 'hybrid',
      params: designParams,
      origin: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const evaluationInput = {
      household: scenarioHousehold,
      system,
      panel: recommendation.panel,
      battery: recommendation.battery,
      inverter: recommendation.inverter,
    };
    const detailed = evaluateSystemBehavior(evaluationInput, 'usual');
    const compact = evaluateCompatibleSystemBehavior(evaluationInput, 'usual');
    expect(compact).not.toBeNull();
    expect(compact?.coverageWorst).toBe(detailed.coverageWorst);
    expect(compact?.energySustainable).toBe(detailed.energySustainable);
    expect(compact?.cookingMealsUnmetWorst).toBe(detailed.cookingMealsUnmetWorst);
    expect(compact?.unservedKwhWorst).toBe(detailed.unservedKwhWorst);
    expect(compact?.blackout.coverage).toBe(detailed.blackout.coverage);
    expect(compact?.scenarios.map((scenario) => scenario.finalSoc)).toEqual(
      detailed.scenarios.map((scenario) => scenario.finalSoc),
    );
    expect(source.appliances).toHaveLength(3);
  });
});
