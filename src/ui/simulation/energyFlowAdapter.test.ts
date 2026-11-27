import { describe, expect, it } from 'vitest';
import type { IntervalResult } from '../../domain/core/types';
import { toEnergyFlowFrames } from './energyFlowAdapter';

describe('toEnergyFlowFrames', () => {
  it('mapea los campos del motor sin reconstruir magnitudes entre fronteras', () => {
    const interval = {
      index: 5,
      pvDcW: 2400,
      pvAcW: 1120,
      batteryChargePvW: 430,
      gridToLoadW: 360,
      gridChargeW: 780,
      batteryDischargeAcW: 210,
      demandW: 1900,
      servedW: 1690,
      unservedW: 210,
      batteryChargeW: 970,
      soc: 0.72,
      curtailedW: 160,
      pvClippedW: 40,
    } as IntervalResult;

    const [frame] = toEnergyFlowFrames([interval], 15, Array.from({ length: 6 }, (_, i) => i === 5));

    expect(frame).toMatchObject({
      time: '01:15',
      pvProductionDcW: 2400,
      pvToLoadAcW: 1120,
      pvToBatteryStoredW: 430,
      gridToLoadAcW: 360,
      gridToBatteryAcW: 780,
      batteryToLoadAcW: 210,
      loadDemandAcW: 1900,
      loadServedAcW: 1690,
      loadUnservedAcW: 210,
      batteryChargeStoredW: 970,
      batterySoc: 72,
      gridAvailable: true,
      pvCurtailedDcW: 160,
      pvClippedDcW: 40,
    });
  });

  it('conserva la hora civil al empezar a las 08:00 y expone las cargas activas', () => {
    const interval = {
      index: 0,
      clockIndex: 32,
      hour: 8.125,
      activeLoads: [{ id: 'phone', name: 'Carga de teléfonos móviles', powerW: 20, kind: 'appliance' }],
      pvDcW: 0,
      pvAcW: 0,
      batteryChargePvW: 0,
      gridToLoadW: 100,
      gridChargeW: 0,
      batteryDischargeAcW: 0,
      demandW: 120,
      servedW: 100,
      unservedW: 20,
      batteryChargeW: 0,
      soc: 0.3,
      gridW: 100,
      curtailedW: 0,
      pvClippedW: 0,
    } as IntervalResult;
    const gridAvailability = new Array<boolean>(96).fill(false);
    gridAvailability[32] = true;
    const [frame] = toEnergyFlowFrames([interval], 15, gridAvailability);

    expect(frame.time).toBe('08:00');
    expect(frame.gridAvailable).toBe(true);
    expect(frame.activeLoads).toEqual([
      { id: 'phone', name: 'Carga de teléfonos móviles', powerW: 20, kind: 'appliance' },
    ]);
  });
});
