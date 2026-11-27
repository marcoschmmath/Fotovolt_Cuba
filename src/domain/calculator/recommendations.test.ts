import { describe, expect, it } from 'vitest';
import { generateSolarRecommendations } from './recommendations';
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

describe('generateSolarRecommendations', () => {
  it('genera tres niveles con equipos reales del catálogo y exige recarga solar diaria', () => {
    const source = household();
    const result = generateSolarRecommendations({
      household: source,
      panels: [panel()],
      batteries: [battery()],
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
      expect(recommendation.finalSoc).toBeGreaterThanOrEqual(0.999);
      expect(recommendation.unservedKwh).toBeLessThanOrEqual(1e-6);
    }
    expect(source.appliances).toHaveLength(3);
  });
});
