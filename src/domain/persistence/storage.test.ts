import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS } from '../core/defaults';
import { createInitialState, isSupportedStep, loadState, saveState } from './storage';
import type { AppState } from './storage';

/**
 * Persistencia de la nueva arquitectura: hogares, instalaciones y fotos de
 * resultados son entidades separadas, y los datos antiguos (v1/v2) migran sin
 * perder los electrodomésticos del usuario.
 */

const KEY_V3 = 'calculadora-solar-cuba:v3';
const KEY_V4 = 'calculadora-solar-cuba:v4';
const KEY_V1 = 'calculadora-solar-cuba:v1';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failSetItem = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failSetItem) {
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.data.set(key, value);
  }
}

let storage: MemoryStorage;

function appliance(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Equipo',
    category: 'Otros',
    icon: 'plug',
    quantity: 1,
    powerW: 150,
    hoursPerDay: 5,
    schedule: 'day',
    startHour: 8,
    priority: 'important',
    surgeFactor: 1,
    dutyCycle: 1,
    profile: 'constant',
    ...over,
  };
}

describe('persistencia (esquema v4: hogares e instalaciones sin configuración comercial)', () => {
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('sin datos guardados devuelve un estado vacío y utilizable', () => {
    const state = loadState();
    expect(state.households).toEqual([]);
    expect(state.installations).toEqual([]);
    expect(state.activeHouseholdId).toBe('');
    expect(state.panels.length).toBeGreaterThan(0);
  });

  it('migra un perfil antiguo (v2) a un hogar con sus electrodomésticos intactos', () => {
    storage.setItem(
      KEY_V1,
      JSON.stringify({
        version: 1,
        appliances: [appliance('n1'), appliance('t1', { powerW: 0 })],
        profiles: [
          { id: 'p1', name: 'Casa vieja', appliances: [appliance('n1'), appliance('t1', { powerW: 0 })], createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        activeProfileId: 'p1',
        params: { ...DEFAULT_PARAMS, dod: 500, stepMinutes: 7 },
        gridInput: { hoursPerDay: 4, pattern: 'evening', startHour: 18, maxPowerW: 4200, voltage: 'both', allowExport: false, chargerPowerW: 1500 },
        panels: [],
        batteries: [],
        inverters: [],
      }),
    );
    const state = loadState();
    expect(state.households).toHaveLength(1);
    expect(state.households[0].name).toBe('Casa vieja');
    // El equipo inservible se descarta; el bueno se conserva.
    expect(state.households[0].appliances.map((a) => a.id)).toEqual(['n1']);
    expect(state.households[0].cooking.substitution).toBe('electric-first');
    expect(state.households[0].activities).toHaveLength(3);
    // Parámetros saneados: DoD recortado y paso restringido a los admitidos.
    expect(state.households[0].cooking.enabled).toBe(true);
    // Se crea una instalación para el hogar migrado, con el límite antiguo.
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0].householdProfileId).toBe(state.households[0].id);
    expect(state.installations[0].params.stepMinutes).toBe(15);
    expect(state.installations[0].params.gridMaxPowerW).toBe(4200);
    expect(state.activeHouseholdId).toBe(state.households[0].id);
    expect(state.activeInstallationId).toBe(state.installations[0].id);
  });

  it('no da por confirmado el gas heredado del valor predeterminado antiguo', () => {
    storage.setItem(
      KEY_V3,
      JSON.stringify({
        version: 3,
        households: [{ id: 'h-legacy-gas', name: 'Casa antigua', appliances: [], cooking: { fuelKind: 'gas' } }],
        installations: [],
        panels: [],
        batteries: [],
        inverters: [],
      }),
    );
    const state = loadState();
    expect(state.households[0].cooking.fuelKind).toBe('gas');
    expect(state.households[0].cooking.fuelConfirmed).toBe(false);
  });

  it('conserva un combustible confirmado explícitamente', () => {
    storage.setItem(
      KEY_V3,
      JSON.stringify({
        version: 3,
        households: [{ id: 'h-confirmed-gas', name: 'Casa con gas', appliances: [], cooking: { fuelKind: 'gas', fuelConfirmed: true } }],
        installations: [],
        panels: [],
        batteries: [],
        inverters: [],
      }),
    );
    const state = loadState();
    expect(state.households[0].cooking.fuelKind).toBe('gas');
    expect(state.households[0].cooking.fuelConfirmed).toBe(true);
  });

  it('migra varios perfiles antiguos a varios hogares', () => {
    storage.setItem(
      KEY_V1,
      JSON.stringify({
        version: 1,
        profiles: [
          { id: 'p1', name: 'Casa', appliances: [appliance('a')], createdAt: 'x' },
          { id: 'p2', name: 'Finca', appliances: [appliance('b')], createdAt: 'x' },
          null,
        ],
        activeProfileId: 'p2',
        panels: [],
        batteries: [],
        inverters: [],
      }),
    );
    const state = loadState();
    expect(state.households.map((h) => h.name)).toEqual(['Casa', 'Finca']);
    expect(state.activeHouseholdId).toBe('p2');
  });

  it('un hogar corrupto no arrastra a los válidos', () => {
    storage.setItem(
      KEY_V3,
      JSON.stringify({
        version: 3,
        households: [null, 42, { id: 'h1', name: 'Casa', appliances: [appliance('a')] }, { appliances: 'roto' }],
        installations: [],
        activeHouseholdId: 'h1',
      }),
    );
    const state = loadState();
    expect(state.households.map((h) => h.id)).toEqual(['h1']);
  });

  it('conserva múltiples instalaciones sobre el mismo hogar', () => {
    const household = { id: 'h1', name: 'Casa', appliances: [appliance('a')] };
    storage.setItem(
      KEY_V3,
      JSON.stringify({
        version: 3,
        households: [household],
        installations: [
          { id: 'i1', householdProfileId: 'h1', name: '5 kWh', panelId: state0().panels[0].id, panelCount: 4, batteryId: state0().batteries[0].id, batteryCount: 1, inverterId: state0().inverters[0].id, installationType: 'hybrid', params: DEFAULT_PARAMS, origin: 'user' },
          { id: 'i2', householdProfileId: 'h1', name: '10 kWh', panelId: state0().panels[0].id, panelCount: 8, batteryId: state0().batteries[0].id, batteryCount: 2, inverterId: state0().inverters[0].id, installationType: 'hybrid', params: DEFAULT_PARAMS, origin: 'user' },
          { id: 'i3', householdProfileId: 'no-existe', name: 'Huérfana', panelId: '', panelCount: 0, batteryId: '', batteryCount: 0, inverterId: '', installationType: 'hybrid', params: DEFAULT_PARAMS, origin: 'user' },
        ],
        activeHouseholdId: 'h1',
      }),
    );
    const state = loadState();
    expect(state.installations.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(state.activeInstallationId).toBe('i1');
  });

  it('las fotos de resultados sobreviven aunque el hogar se borre', () => {
    const household = { id: 'h1', name: 'Casa', appliances: [appliance('a')] };
    storage.setItem(
      KEY_V3,
      JSON.stringify({
        version: 3,
        households: [household],
        installations: [],
        simulations: [
          {
            id: 's1',
            createdAt: '2026-05-01T12:00:00.000Z',
            householdProfileId: 'h1',
            systemConfigurationId: 'i9',
            householdName: 'Casa',
            systemName: '5 kWh',
            householdKwhPerDay: 4.2,
            assumptions: { hsp: 4.5, dod: 0.8, minSoc: 0.15, inverterEfficiency: 0.92, chargerEfficiency: 0.95, gridImportLimitW: 3000 },
            metrics: { coverageMedian: 0.8, coverageWorst: 0.4, coverageBest: 0.95, unservedKwhWorst: 2, gridKwhMedian: 3, pvKwhMedian: 4, blackoutCoverage: 0.3, blackoutUnservedKwh: 3, cookingMealsUnmetWorst: 1, nightDeficitKwhWorst: 0.5, minSocWorst: 0.15 },
          },
        ],
        activeHouseholdId: 'h1',
      }),
    );
    const state = loadState();
    expect(state.simulations).toHaveLength(1);
    expect(state.simulations[0].metrics.coverageMedian).toBe(0.8);
  });

  it('restringe los pasos de simulación admitidos', () => {
    expect(isSupportedStep(15)).toBe(true);
    expect(isSupportedStep(7)).toBe(false);
    storage.setItem(
      KEY_V3,
      JSON.stringify({
        version: 3,
        households: [{ id: 'h1', name: 'Casa', appliances: [], activities: [] }],
        installations: [
          { id: 'i1', householdProfileId: 'h1', name: 'X', panelId: '', panelCount: 0, batteryId: '', batteryCount: 1, inverterId: '', installationType: 'hybrid', params: { ...DEFAULT_PARAMS, stepMinutes: 7 }, origin: 'user' },
        ],
      }),
    );
    expect(loadState().installations[0].params.stepMinutes).toBe(15);
  });

  it('migra v3 y descarta la configuración comercial y el PIN heredados', () => {
    storage.setItem(
      KEY_V3,
      JSON.stringify({
        version: 3,
        households: [],
        installations: [],
        simulations: [],
        panels: [],
        batteries: [],
        inverters: [],
        commercial: {
          businessName: 'Nombre antiguo editable',
          phone: '+5300000000',
          pin: '1234',
        },
      }),
    );

    const state = loadState();
    expect('commercial' in state).toBe(false);

    saveState(state);
    const saved = JSON.parse(storage.getItem(KEY_V4) as string);
    expect(saved.version).toBe(4);
    expect('commercial' in saved).toBe(false);
    expect(storage.getItem(KEY_V3)).toBeNull();
  });

  it('guarda con la versión actual y tolera la cuota agotada', () => {
    storage.failSetItem = true;
    expect(() => saveState(createInitialState())).not.toThrow();
    storage.failSetItem = false;
    saveState(createInitialState());
    expect(JSON.parse(storage.getItem(KEY_V4) as string).version).toBe(4);
  });

  it('no rompe con JSON inválido', () => {
    storage.setItem(KEY_V4, '{no es json');
    expect(() => loadState()).not.toThrow();
    expect(loadState().households).toEqual([]);
  });

  it('conserva todos los MPPT y tensiones AC de un inversor guardado (C7)', () => {
    const inverter = {
      ...createInitialState().inverters[0],
      id: 'inv-multi',
      mppt: [
        { maxVoltageV: 450, minVoltageV: 120, maxCurrentA: 18, maxPowerW: 6000 },
        { maxVoltageV: 450, minVoltageV: 120, maxCurrentA: 18, maxPowerW: 6000 },
      ],
      acVoltages: [110, 220],
      gridChargerW: 2000,
    };
    storage.setItem(KEY_V3, JSON.stringify({ version: 3, households: [], installations: [], inverters: [inverter] }));
    const restored = loadState().inverters.find((i) => i.id === 'inv-multi');
    expect(restored?.mppt).toHaveLength(2);
    expect(restored?.acVoltages).toEqual([110, 220]);
    expect(restored?.gridChargerW).toBe(2000);
  });

  it('elimina la capacidad de exportación de los datos antiguos', () => {
    storage.setItem(
      KEY_V1,
      JSON.stringify({
        version: 1,
        appliances: [appliance('a')],
        params: { ...DEFAULT_PARAMS, allowExport: true, gridChargePowerW: 1500 },
        panels: [],
        batteries: [],
        inverters: [],
      }),
    );
    const state = loadState();
    expect('allowExport' in (state.installations[0].params as object)).toBe(false);
    expect(state.households[0].cooking).toBeTruthy();
  });
  it('conserva la categoría de cargas en una instalación recomendada', () => {
    const state = createInitialState();
    state.households = [{
      id: 'home-recommended',
      name: 'Casa recomendada',
      appliances: [appliance('critical')],
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
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as AppState['households'][number]];
    state.activeHouseholdId = 'home-recommended';
    state.installations = [{
      id: 'installation-recommended',
      householdProfileId: 'home-recommended',
      name: 'Moderada',
      panelId: state.panels[0].id,
      panelCount: 4,
      batteryId: state.batteries[0].id,
      batteryCount: 1,
      inverterId: state.inverters[0].id,
      installationType: 'hybrid',
      params: { ...DEFAULT_PARAMS },
      recommendationTier: 'moderate',
      origin: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }];
    saveState(state);

    const restored = loadState();

    expect(restored.installations[0].recommendationTier).toBe('moderate');
  });

});

function state0() {
  return createInitialState();
}