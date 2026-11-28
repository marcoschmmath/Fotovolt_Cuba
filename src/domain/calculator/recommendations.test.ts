import { describe, expect, it } from 'vitest';
import { batteryBankFitsNightEnergy, generateSolarRecommendations, RECOMMENDATION_LIMITS } from './recommendations';
import { batteryPack } from './battery';
import type { HouseholdProfile } from '../household/types';
import { DEFAULT_COOKING, defaultCookingActivities } from '../household/types';
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
  it('genera tres niveles aplicando el criterio de compatibilidad existente (08:00, SOC inicial 30 %)', () => {
    const source = household();
    const result = generateSolarRecommendations({
      household: source,
      panels: [panel()],
      batteries: [battery({ nominalKwh: 1.4 })],
      inverters: [inverter()],
      params: params(),
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
    expect(source.appliances).toHaveLength(3);
  });
});
