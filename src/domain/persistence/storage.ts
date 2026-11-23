import type { Appliance, BatterySpec, DesignParams, InverterSpec, PanelSpec } from '../core/types';
import type { GridInput } from '../simulator/grid';
import type { CommercialConfig } from '../config/commercial';
import { DEFAULT_COMMERCIAL } from '../config/commercial';
import { DEFAULT_PARAMS, REFERENCE_BATTERIES, REFERENCE_INVERTERS, REFERENCE_PANELS } from '../core/defaults';
import { VERIFIED_BATTERIES, VERIFIED_INVERTERS, VERIFIED_PANELS } from '../catalog/verifiedEquipment';

export interface RecentCalculation {
  id: string;
  date: string;
  label: string;
  optionId: 'economica' | 'equilibrada' | 'autonomia';
  dailyKwh: number;
  panelCount: number;
  batteryKwh: number;
  inverterW: number;
  coverage: number;
}

export interface EquipmentProfile {
  id: string;
  name: string;
  appliances: Appliance[];
  createdAt: string;
}

export interface AppState {
  version: 1;
  appliances: Appliance[];
  profiles: EquipmentProfile[];
  activeProfileId: string;
  params: DesignParams;
  gridInput: GridInput;
  installationType: 'hybrid' | 'offgrid';
  wizardStep: number;
  selectedOptionId: 'economica' | 'equilibrada' | 'autonomia';
  panelId: string;
  batteryId: string;
  inverterId: string;
  panels: PanelSpec[];
  batteries: BatterySpec[];
  inverters: InverterSpec[];
  commercial: CommercialConfig;
  recent: RecentCalculation[];
}

const KEY = 'calculadora-solar-cuba:v1';

export const DEFAULT_GRID_INPUT: GridInput = {
  hoursPerDay: 3,
  pattern: 'evening',
  startHour: 18,
  maxPowerW: 3000,
  voltage: 'both',
  allowExport: false,
  chargerPowerW: 1500,
};

export function createInitialState(): AppState {
  const profileId = 'profile-principal';
  return {
    version: 1,
    appliances: [],
    profiles: [{ id: profileId, name: 'Mi vivienda', appliances: [], createdAt: new Date().toISOString() }],
    activeProfileId: profileId,
    params: { ...DEFAULT_PARAMS },
    gridInput: { ...DEFAULT_GRID_INPUT },
    installationType: 'hybrid',
    wizardStep: 1,
    selectedOptionId: 'equilibrada',
    panelId: VERIFIED_PANELS[0].id,
    batteryId: VERIFIED_BATTERIES[0].id,
    inverterId: VERIFIED_INVERTERS[0].id,
    panels: [...VERIFIED_PANELS, ...REFERENCE_PANELS].map((p) => ({ ...p })),
    batteries: [...VERIFIED_BATTERIES, ...REFERENCE_BATTERIES].map((b) => ({ ...b })),
    inverters: [...VERIFIED_INVERTERS, ...REFERENCE_INVERTERS].map((i) => ({ ...i, mppt: i.mppt.map((m) => ({ ...m })) })),
    commercial: { ...DEFAULT_COMMERCIAL },
    recent: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeCatalog<T extends { id: string }>(stored: unknown, defaults: T[]): T[] {
  const list = Array.isArray(stored) ? (stored as T[]) : [];
  const ids = new Set(list.map((item) => item.id));
  return [...list, ...defaults.filter((item) => !ids.has(item.id))];
}

/** Carga tolerante: nunca rompe la app si el almacenamiento está corrupto. */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return createInitialState();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return createInitialState();
    const base = createInitialState();
    const rawProfiles = Array.isArray(parsed.profiles) ? (parsed.profiles as EquipmentProfile[]) : [];
    const profiles = rawProfiles.length
      ? rawProfiles
      : [
          {
            ...base.profiles[0],
            appliances: Array.isArray(parsed.appliances) ? (parsed.appliances as Appliance[]) : [],
          },
        ];
    const activeProfileId = profiles.some((p) => p.id === parsed.activeProfileId)
      ? (parsed.activeProfileId as string)
      : profiles[0].id;
    return {
      ...base,
      ...(parsed as Partial<AppState>),
      profiles,
      activeProfileId,
      appliances: profiles.find((p) => p.id === activeProfileId)?.appliances ?? [],
      params: { ...base.params, ...((parsed.params as DesignParams) ?? {}) },
      gridInput: { ...base.gridInput, ...((parsed.gridInput as GridInput) ?? {}) },
      commercial: { ...base.commercial, ...((parsed.commercial as CommercialConfig) ?? {}) },
      panels: mergeCatalog(parsed.panels, base.panels),
      batteries: mergeCatalog(parsed.batteries, base.batteries),
      inverters: mergeCatalog(parsed.inverters, base.inverters),
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      version: 1,
    };
  } catch {
    return createInitialState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Modo privado o cuota agotada: la aplicación sigue funcionando en memoria.
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento disponible.
  }
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
