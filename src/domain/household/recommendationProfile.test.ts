import { describe, expect, it } from 'vitest';
import { householdForRecommendation } from './recommendationProfile';
import type { HouseholdProfile } from './types';
import { appliance } from '../../test/fixtures';
import { DEFAULT_COOKING, defaultCookingActivities } from './types';

function household(): HouseholdProfile {
  return {
    id: 'home-1',
    name: 'Casa de prueba',
    appliances: [
      appliance({ id: 'critical', priority: 'critical', schedule: 'night' }),
      appliance({ id: 'important', priority: 'important', schedule: 'day' }),
      appliance({ id: 'optional', priority: 'discretionary', schedule: 'day' }),
    ],
    cooking: { ...DEFAULT_COOKING, enabled: true },
    activities: defaultCookingActivities().map((activity) => ({
      ...activity,
      essential: activity.id === 'dinner',
    })),
    night: { essentialIds: ['important'] },
    voltage: 220,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('householdForRecommendation', () => {
  it('filtra cargas según la categoría sin modificar el perfil guardado', () => {
    const source = household();

    const essential = householdForRecommendation(source, 'essential');
    const moderate = householdForRecommendation(source, 'moderate');
    const roomy = householdForRecommendation(source, 'roomy');

    expect(essential.appliances.map((item) => item.id)).toEqual(['critical', 'important']);
    expect(moderate.appliances.map((item) => item.id)).toEqual(['critical', 'important']);
    expect(roomy.appliances).toHaveLength(3);
    expect(essential.activities.map((item) => item.id)).toEqual(['dinner']);
    expect(moderate.activities).toHaveLength(3);
    expect(roomy.activities).toHaveLength(3);
    expect(source.appliances).toHaveLength(3);
    expect(source.activities).toHaveLength(3);
    expect(source.night.essentialIds).toEqual(['important']);
  });
});
