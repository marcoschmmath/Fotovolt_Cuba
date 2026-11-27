import type { HouseholdProfile } from './types';
import { effectivePriority } from './types';

export type RecommendationTierId = 'essential' | 'moderate' | 'roomy';

/**
 * Deriva un perfil de consumo para una recomendación sin modificar el perfil
 * guardado del usuario. Las instalaciones recomendadas conservan esta
 * selección también al abrir simulaciones o comparaciones.
 */
export function householdForRecommendation(
  household: HouseholdProfile,
  tier: RecommendationTierId,
): HouseholdProfile {
  const appliances = household.appliances
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

  const applianceIds = new Set(appliances.map((appliance) => appliance.id));
  const activities = household.cooking.enabled
    ? household.activities.filter((activity) =>
        activity.enabled && (tier !== 'essential' || activity.essential),
      )
    : [];

  return {
    ...household,
    appliances,
    activities,
    night: {
      essentialIds: household.night.essentialIds.filter((id) => applianceIds.has(id)),
    },
  };
}
