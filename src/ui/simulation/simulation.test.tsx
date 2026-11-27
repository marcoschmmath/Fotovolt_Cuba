import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildDemoFrames } from './demoFrames';
import { EnergyDiagram } from './EnergyDiagram';
import type { EnergyFlowFrame } from './energyFlow';
import { describeFrame, formatPower, frameTotals, intervalEnergyKwhToW } from './energyFlow';

const EPS = 1e-6;

const idle: EnergyFlowFrame = {
  time: '03:00',
  pvProductionDcW: 0,
  pvToLoadAcW: 0,
  pvToBatteryStoredW: 0,
  gridToLoadAcW: 0,
  gridToBatteryAcW: 0,
  batteryToLoadAcW: 0,
  loadDemandAcW: 0,
  loadServedAcW: 0,
  loadUnservedAcW: 0,
  batteryChargeStoredW: 0,
  batterySoc: 50,
  gridAvailable: false,
};

describe('conversión y formato', () => {
  it('0,25 kWh en un intervalo de 15 min son 1000 W', () => {
    expect(intervalEnergyKwhToW(0.25)).toBeCloseTo(1000, 6);
  });

  it('formatea potencias en W y kW', () => {
    expect(formatPower(850)).toBe('850 W');
    expect(formatPower(1200)).toBe('1,2 kW');
    expect(formatPower(Number.NaN)).toBe('0 W');
  });

  it('conserva las fronteras eléctricas y trata valores inválidos como 0', () => {
    const t = frameTotals({
      ...idle,
      pvProductionDcW: 1400,
      pvToLoadAcW: 800,
      pvToBatteryStoredW: 500,
      gridToLoadAcW: Number.NaN,
      batteryToLoadAcW: -50,
      loadDemandAcW: 900,
      loadServedAcW: 800,
      loadUnservedAcW: 100,
      pvCurtailedDcW: 100,
    });
    expect(t.pvProductionDcW).toBe(1400);
    expect(t.pvToLoadAcW).toBe(800);
    expect(t.pvToBatteryStoredW).toBe(500);
    expect(t.loadServedAcW).toBe(800);
    expect(t.gridToLoadAcW).toBe(0);
    expect(t.pvCurtailedDcW).toBe(100);
  });

  it('describe el apagón para lectores de pantalla', () => {
    expect(describeFrame(idle)).toContain('no hay red eléctrica');
  });
});

describe('buildDemoFrames', () => {
  const frames = buildDemoFrames();

  it('genera 96 intervalos de 15 minutos', () => {
    expect(frames).toHaveLength(96);
    expect(frames[0]?.time).toBe('00:00');
    expect(frames[95]?.time).toBe('23:45');
  });

  it('la ventana de red dura 3 h (12 intervalos)', () => {
    expect(frames.filter((f) => f.gridAvailable)).toHaveLength(12);
  });

  it('respeta límites físicos en todos los intervalos', () => {
    for (const f of frames) {
      const t = frameTotals(f);
      for (const v of [f.pvToLoadAcW, f.pvToBatteryStoredW, f.gridToLoadAcW, f.gridToBatteryAcW, f.batteryToLoadAcW]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-EPS);
      }
      expect(t.socPct).toBeGreaterThanOrEqual(20 - EPS);
      expect(t.socPct).toBeLessThanOrEqual(100 + EPS);
      expect(t.gridImportAcW).toBeLessThanOrEqual(3000 + EPS);
      if (!f.gridAvailable) expect(t.gridImportAcW).toBe(0);
      expect(t.batteryChargeStoredW > EPS && t.batteryToLoadAcW > EPS).toBe(false);
    }
  });
});

describe('EnergyDiagram', () => {
  it('sin flujos no dibuja líneas activas y marca "Sin red"', () => {
    const html = renderToStaticMarkup(<EnergyDiagram frame={idle} />);
    expect(html).toContain('Sin red');
    expect(html).not.toContain('ed-flow__line');
    expect(html).not.toContain('NaN');
  });

  it('dibuja todos los tramos y conserva la identidad de cada flujo', () => {
    const html = renderToStaticMarkup(
      <EnergyDiagram
        frame={{
          ...idle,
          gridAvailable: true,
          pvProductionDcW: 1800,
          pvToLoadAcW: 800,
          pvToBatteryStoredW: 500,
          loadDemandAcW: 800,
          loadServedAcW: 800,
          batteryChargeStoredW: 500,
          batterySoc: 60,
        }}
      />,
    );
    // PV→cargas atraviesa el inversor y por eso se dibuja en dos segmentos;
    // PV→batería usa un tercero. Son dos flujos lógicos, no dos paths SVG.
    const flowIds = [...html.matchAll(/data-flow-id=\"([^\"]+)\"/g)].map((match) => match[1]);
    expect(flowIds).toEqual(['pv-load', 'pv-load', 'pv-battery']);
    expect(new Set(flowIds)).toEqual(new Set(['pv-load', 'pv-battery']));
    expect(html.match(/ed-flow__line/g)).toHaveLength(3);
    expect(html).toContain('1,8 kW');
  });

  it('en modo estático marca las líneas como no animadas', () => {
    const html = renderToStaticMarkup(
      <EnergyDiagram frame={{ ...idle, pvToLoadAcW: 300, loadDemandAcW: 300, loadServedAcW: 300 }} animated={false} />,
    );
    expect(html).toContain('data-animated="false"');
  });
});
