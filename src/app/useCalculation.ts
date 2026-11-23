import { useMemo } from 'react';
import type { AppState } from '../domain/persistence/storage';
import { solarFromParams } from '../domain/core/defaults';
import { buildGridModel } from '../domain/simulator/grid';
import { buildComparison, computeSizing } from '../domain/calculator/sizing';
import { simulate } from '../domain/simulator/engine';
import { buildScenarios } from '../domain/simulator/scenarios';
import { analyzeBottlenecks, estimateRechargeHours } from '../domain/simulator/analysis';

/** Único puente entre la interfaz y los motores matemáticos. */
export function useCalculation(state: AppState) {
  return useMemo(() => {
    const panel = state.panels.find((p) => p.id === state.panelId) ?? state.panels[0];
    const battery = state.batteries.find((b) => b.id === state.batteryId) ?? state.batteries[0];
    const inverters = state.inverters;
    const builtGrid = buildGridModel(state.gridInput, state.params);
    const grid =
      state.installationType === 'offgrid'
        ? { ...builtGrid, available: builtGrid.available.map(() => false) }
        : builtGrid;
    const solar = solarFromParams(state.params);
    const input = {
      appliances: state.appliances,
      params: state.params,
      panel,
      battery,
      inverters,
      voltage: state.gridInput.voltage,
      grid,
      solar,
      preferredInverterId: state.inverterId,
    };
    const sizing = computeSizing(input);
    const options = buildComparison(input, sizing);
    const optionResults = options.map((option) => (option.config ? simulate(option.config) : null));
    const recommendedIndex = Math.max(0, options.findIndex((o) => o.id === 'equilibrada'));
    const recommendedConfig = options[recommendedIndex]?.config ?? sizing.config;
    const scenarios = recommendedConfig
      ? buildScenarios(recommendedConfig).map((scenario) => ({
          scenario,
          result: simulate(scenario.config),
        }))
      : [];
    const bottlenecks = recommendedConfig && optionResults[recommendedIndex]
      ? analyzeBottlenecks(recommendedConfig, optionResults[recommendedIndex]!)
      : [];
    const recharge = recommendedConfig
      ? {
          withGrid: estimateRechargeHours(recommendedConfig, 'solar-grid'),
          solarOnly: estimateRechargeHours(recommendedConfig, 'solar-only'),
        }
      : { withGrid: null, solarOnly: null };

    return {
      panel,
      battery,
      grid,
      solar,
      sizing,
      options,
      optionResults,
      recommendedIndex,
      scenarios,
      bottlenecks,
      recharge,
      hasLoads: state.appliances.some((a) => a.quantity > 0 && a.powerW > 0),
    };
  }, [state]);
}

export type Calculation = ReturnType<typeof useCalculation>;
