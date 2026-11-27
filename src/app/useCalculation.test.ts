import { describe, expect, it } from 'vitest';
import type { AppState } from '../domain/persistence/storage';
import type { HouseholdProfile } from '../domain/household/types';
import type { SystemConfiguration } from '../domain/system/types';
import { resolveInstallation } from './useCalculation';
import { appliance } from '../test/fixtures';

function stateWithOneInstallation(): AppState {
  const household = { id: 'household-owned', name: 'Casa guardada' } as HouseholdProfile;
  const installation = {
    id: 'install-owned',
    householdProfileId: 'household-owned',
    panelCount: 4,
    batteryCount: 1,
  } as SystemConfiguration;

  return {
    households: [household],
    installations: [installation],
    panels: [],
    batteries: [],
    inverters: [],
    activeHouseholdId: 'another-household',
    activeInstallationId: 'install-owned',
  } as unknown as AppState;
}

describe('resolveInstallation', () => {
  it('resuelve la vivienda asociada a la instalación solicitada, no la activa', () => {
    const resolved = resolveInstallation(stateWithOneInstallation(), 'install-owned');

    expect(resolved.system?.id).toBe('install-owned');
    expect(resolved.household?.id).toBe('household-owned');
    expect(resolved.requestedInstallationMissing).toBe(false);
  });

  it('no sustituye un ID inexistente por la instalación activa', () => {
    const resolved = resolveInstallation(stateWithOneInstallation(), 'does-not-exist');

    expect(resolved.system).toBeNull();
    expect(resolved.household).toBeNull();
    expect(resolved.requestedInstallationMissing).toBe(true);
  });
  it('evalúa una instalación recomendada sólo con el nivel de cargas elegido', () => {
    const base = stateWithOneInstallation();
    const originalHousehold = {
      ...base.households[0],
      appliances: [
        appliance({ id: 'critical', priority: 'critical' }),
        appliance({ id: 'optional', priority: 'discretionary' }),
      ],
      cooking: {
        enabled: false,
        fuelKind: null,
        fuelConfirmed: false,
        substitution: 'electric-first',
        allowFlexibleTiming: true,
      },
      activities: [],
      night: { essentialIds: [] },
      voltage: 220,
    } as HouseholdProfile;
    const recommendedSystem = {
      ...base.installations[0],
      recommendationTier: 'essential' as const,
    };
    const state = {
      ...base,
      households: [originalHousehold],
      installations: [recommendedSystem],
    } as AppState;

    const resolved = resolveInstallation(state, 'install-owned');

    expect(resolved.household?.appliances.map((item) => item.id)).toEqual(['critical']);
    expect(originalHousehold.appliances).toHaveLength(2);
  });

});
