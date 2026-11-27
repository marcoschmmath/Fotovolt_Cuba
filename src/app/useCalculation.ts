import { useMemo } from 'react';
import type { AppState } from '../domain/persistence/storage';
import type { HouseholdProfile } from '../domain/household/types';
import type { SystemConfiguration } from '../domain/system/types';
import type { BatterySpec, InverterSpec, PanelSpec } from '../domain/core/types';
import { evaluateSystem, type EvaluationInput, type SystemEvaluation } from '../domain/simulator/scenarioGrid';
import { householdForRecommendation } from '../domain/household/recommendationProfile';

export interface Resolved<T extends { id: string }> {
  item: T;
}

/** Resuelve una instalación con su hogar y su equipo del catálogo del usuario. */
export interface ActiveInstallation {
  household: HouseholdProfile | null;
  system: SystemConfiguration | null;
  panel: PanelSpec | null;
  battery: BatterySpec | null;
  inverter: InverterSpec | null;
  /** El hogar existe pero la instalación no tiene cantidades definidas. */
  needsDesign: boolean;
  /** Se solicitó explícitamente un ID que no existe; no se debe usar otra instalación. */
  requestedInstallationMissing: boolean;
}

export function resolveInstallation(state: AppState, installationId?: string): ActiveInstallation {
  const requestedSystem = installationId
    ? state.installations.find((i) => i.id === installationId) ?? null
    : null;
  const requestedInstallationMissing = Boolean(installationId && !requestedSystem);
  // Una ruta con ID explícito siempre se resuelve por ese ID. Si no existe,
  // no hacemos fallback a la instalación activa ni a otra del hogar actual.
  const system = installationId
    ? requestedSystem
    : state.installations.find((i) => i.id === state.activeInstallationId) ??
      state.installations.find((i) => i.householdProfileId === state.activeHouseholdId) ??
      null;
  const storedHousehold = system
    ? (state.households.find((h) => h.id === system.householdProfileId) ?? null)
    : requestedInstallationMissing
      ? null
      : (state.households.find((h) => h.id === state.activeHouseholdId) ?? null);
  // Una recomendación evalúa exactamente el subconjunto de cargas para el que
  // fue dimensionada. El perfil guardado del usuario permanece intacto.
  const recommendationTier = system?.recommendationTier;
  const household = storedHousehold && recommendationTier
    ? householdForRecommendation(storedHousehold, recommendationTier)
    : storedHousehold;
  const panel = system ? (state.panels.find((p) => p.id === system.panelId) ?? null) : null;
  const battery = system ? (state.batteries.find((b) => b.id === system.batteryId) ?? null) : null;
  const inverter = system ? (state.inverters.find((i) => i.id === system.inverterId) ?? null) : null;
  return {
    household,
    system,
    panel,
    battery,
    inverter,
    // Sin paneles o sin batería la instalación no está definida: el asistente
    // debe pedirlos en lugar de simular un sistema incompleto.
    needsDesign: Boolean(system && (system.panelCount < 1 || system.batteryCount < 1)),
    requestedInstallationMissing,
  };
}

/**
 * Evalúa una instalación sobre los 24 escenarios + apagón total, con los dos
 * comportamientos de cocción. Memoizado por identidad de hogar e instalación.
 */
export function useEvaluation(state: AppState, installationId?: string): {
  evaluation: SystemEvaluation | null;
  active: ActiveInstallation;
} {
  const active = useMemo(() => resolveInstallation(state, installationId), [state, installationId]);
  const evaluation = useMemo(() => {
    if (!active.household || !active.system || !active.panel || !active.battery || !active.inverter) return null;
    if (active.needsDesign) return null;
    const input: EvaluationInput = {
      household: active.household,
      system: active.system,
      panel: active.panel,
      battery: active.battery,
      inverter: active.inverter,
    };
    return evaluateSystem(input);
  }, [active.household, active.system, active.panel, active.battery, active.inverter, active.needsDesign]);
  return { evaluation, active };
}

/** Evalúa una oferta introducida a mano contra un hogar existente. */
export function useOfferEvaluation(
  _state: AppState,
  household: HouseholdProfile | null,
  system: SystemConfiguration | null,
  panel: PanelSpec | null,
  battery: BatterySpec | null,
  inverter: InverterSpec | null,
): SystemEvaluation | null {
  return useMemo(() => {
    if (!household || !system || !panel || !battery || !inverter) return null;
    if (system.panelCount < 1 && system.batteryCount < 1) return null;
    return evaluateSystem({ household, system, panel, battery, inverter });
  }, [household, system, panel, battery, inverter]);
}

/**
 * Comparación de TODAS las instalaciones de un hogar,para que el cliente vea
 * qué opción rinde mejor en el peor caso sin abrirlas una por una.
 */
export function useHouseholdComparison(
  state: AppState,
  householdId: string,
): Array<{ system: SystemConfiguration; evaluation: SystemEvaluation }> {
  return useMemo(() => {
    return state.installations
      .filter((system) => system.householdProfileId === householdId && system.panelCount + system.batteryCount > 0)
      .map((system) => {
        const storedHousehold = state.households.find((h) => h.id === system.householdProfileId);
        const household = storedHousehold && system.recommendationTier
          ? householdForRecommendation(storedHousehold, system.recommendationTier)
          : storedHousehold;
        const panel = state.panels.find((p) => p.id === system.panelId);
        const battery = state.batteries.find((b) => b.id === system.batteryId);
        const inverter = state.inverters.find((i) => i.id === system.inverterId);
        if (!household || !panel || !battery || !inverter) return null;
        return { system, evaluation: evaluateSystem({ household, system, panel, battery, inverter }) };
      })
      .filter((row): row is { system: SystemConfiguration; evaluation: SystemEvaluation } => row !== null);
  }, [state]);
}