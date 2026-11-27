import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../core/defaults';
import {
  BLACKOUT_SCENARIO_ID,
  GRID_RETURN_SCENARIO_COUNT,
  GRID_RETURN_WINDOW_HOURS,
  blackoutScenario,
  gridReturnScenarios,
  scenarioById,
} from './gridScenarios';

const params = { ...DEFAULT_PARAMS, stepMinutes: 15 };

describe('escenarios de retorno de red', () => {
  it('genera exactamente 24 escenarios con comienzos separados una hora', () => {
    const scenarios = gridReturnScenarios(params);
    expect(scenarios).toHaveLength(GRID_RETURN_SCENARIO_COUNT);
    scenarios.forEach((scenario, index) => {
      expect(scenario.id).toBe(`rt-${String(index).padStart(2, '0')}`);
      expect(scenario.startHour).toBe(index);
      expect(scenario.label).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2}$/);
    });
  });

  it('cada ventana dura exactamente 12 intervalos (3 h a 15 min)', () => {
    for (const scenario of gridReturnScenarios(params)) {
      expect(scenario.available).toHaveLength(96);
      expect(scenario.available.filter(Boolean)).toHaveLength(
        (GRID_RETURN_WINDOW_HOURS * 60) / params.stepMinutes,
      );
    }
  });

  it('la ventana 23:00–02:00 cruza la medianoche correctamente', () => {
    const night = scenarioById('rt-23', params);
    expect(night.available.slice(0, 8).every(Boolean)).toBe(true); // 00:00–02:00
    expect(night.available[95]).toBe(true); // 23:45
    expect(night.available[40]).toBe(false); // 10:00
  });

  it('el conjunto cubre el día completo sin huecos entre escenarios extremos', () => {
    const scenarios = gridReturnScenarios(params);
    for (let interval = 0; interval < 96; interval += 1) {
      // Cada instante del día cae dentro de exactamente 3 ventanas
      // (las que empiezan en t-2h, t-1h y t): no hay instante sin cubrir.
      const candles = scenarios.filter((s) => s.available[interval]).length;
      expect(candles).toBe(GRID_RETURN_WINDOW_HOURS);
    }
  });

  it('es determinista: los identificadores no dependen del paso ni del equipo', () => {
    expect(gridReturnScenarios(params).map((s) => s.id)).toEqual(
      gridReturnScenarios(params).map((s) => s.id),
    );
    const halfHour = { ...DEFAULT_PARAMS, stepMinutes: 30 };
    const scenarios = gridReturnScenarios(halfHour);
    expect(scenarios.map((s) => s.id)).toEqual(gridReturnScenarios(params).map((s) => s.id));
    for (const scenario of scenarios) {
      expect(scenario.available).toHaveLength(48);
      expect(scenario.available.filter(Boolean)).toHaveLength(6); // 3 h a 30 min
    }
  });

  it('el apagón total no tiene ningún intervalo con red', () => {
    const blackout = blackoutScenario(params);
    expect(blackout.id).toBe(BLACKOUT_SCENARIO_ID);
    expect(blackout.available).toHaveLength(96);
    expect(blackout.available.some(Boolean)).toBe(false);
  });

  it('el escenario destacado 09:00 cubre la franja del almuerzo temprano', () => {
    const nine = scenarioById('rt-09', params);
    // Intervalos de 11:00 a 12:00 (preparar el almuerzo antes de servirlo).
    const lunchInterval = (11 * 60) / params.stepMinutes;
    expect(nine.available[lunchInterval]).toBe(true);
    expect(nine.available[0]).toBe(false);
  });
});