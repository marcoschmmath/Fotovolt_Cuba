import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { solarFromParams } from '../domain/core/defaults';
import { buildGridModel } from '../domain/simulator/grid';
import { checkOffer, type OfferReport } from '../domain/simulator/offer';
import { Badge, Button, Note, NumberField, Panel, SectionTitle, Stat, fmtKwh, fmtW } from '../ui/components';

export function OfferCheck() {
  const { state } = useApp();
  const [form, setForm] = useState({
    panelCount: 8,
    panelW: 550,
    batteryCount: 2,
    batteryKwhEach: 5,
    batteryV: 51.2,
    batteryMaxDischargeW: 5120,
    batteryDod: 0.8,
    batteryChargeEff: 0.95,
    batteryDischargeEff: 0.95,
    inverterRatedW: 5000,
    inverterSurgeW: 10000,
    inverterMaxPvInputW: 8000,
    inverterChargeA: 120,
    inverterDischargeA: 120,
    batteryVoltageV: 48,
  });
  const [report, setReport] = useState<OfferReport | null>(null);

  function set(key: keyof typeof form, value: number) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function run() {
    const grid = buildGridModel(state.gridInput, state.params);
    setReport(
      checkOffer({
        ...form,
        appliances: state.appliances,
        params: state.params,
        grid,
        solar: solarFromParams(state.params),
        voltage: state.gridInput.voltage,
      }),
    );
  }

  return (
    <>
      <SectionTitle eyebrow="Segunda opinión" title="Comprobar una instalación que me han ofrecido" description="Introduce los datos de la propuesta. El informe contrasta esos datos con tu consumo y señala lo que falta por verificar. No emite juicios sobre ningún vendedor." />

      {state.appliances.length === 0 && (
        <Note level="warning" title="Falta tu consumo">Añade tus equipos en la calculadora para que la comparación tenga sentido.</Note>
      )}

      <Panel tone="paper">
        <h3>Paneles solares</h3>
        <div className="selected-item__grid">
          <NumberField label="Cantidad" value={form.panelCount} min={0} step={1} onChange={(v) => set('panelCount', v)} />
          <NumberField label="Potencia por panel" value={form.panelW} min={1} step={10} unit="W" onChange={(v) => set('panelW', v)} />
        </div>
        <Note level="info">
          No pedimos el Voc: en Cuba la temperatura mínima ronda los 15 °C durante todo el año, así que el peor caso de tensión en frío no suele ser el que limita. Sí revisamos la potencia y los límites del inversor.
        </Note>
      </Panel>

      <Panel tone="paper">
        <div className="panel__head">
          <h3>Baterías</h3>
          <Badge tone="storage">{form.batteryCount} × {form.batteryKwhEach} kWh = {(form.batteryCount * form.batteryKwhEach).toFixed(1)} kWh</Badge>
        </div>
        <div className="selected-item__grid">
          <NumberField label="Cantidad de baterías" value={form.batteryCount} min={0} step={1} onChange={(v) => set('batteryCount', v)} />
          <NumberField label="Capacidad de cada una" value={form.batteryKwhEach} min={0} step={0.1} unit="kWh" onChange={(v) => set('batteryKwhEach', v)} />
          <NumberField label="Tensión de cada batería" value={form.batteryV} min={0} step={0.1} unit="V" onChange={(v) => set('batteryV', v)} />
          <NumberField label="Descarga máxima (BMS)" value={form.batteryMaxDischargeW} min={0} step={100} unit="W" onChange={(v) => set('batteryMaxDischargeW', v)} />
          <NumberField label="Profundidad de descarga" value={form.batteryDod} min={0.4} max={1} step={0.05} onChange={(v) => set('batteryDod', v)} />
          <NumberField label="Eficiencia de carga" value={form.batteryChargeEff} min={0.7} max={1} step={0.01} onChange={(v) => set('batteryChargeEff', v)} />
          <NumberField label="Eficiencia de descarga" value={form.batteryDischargeEff} min={0.7} max={1} step={0.01} onChange={(v) => set('batteryDischargeEff', v)} />
          <NumberField label="Tensión del banco del inversor" value={form.batteryVoltageV} min={0} step={1} unit="V" onChange={(v) => set('batteryVoltageV', v)} />
        </div>
        <Note level="info">Indica cuántas baterías son y los datos de cada una. La app suma la capacidad total; no tienes que hacer cuentas.</Note>
      </Panel>

      <Panel tone="paper">
        <h3>Inversor</h3>
        <div className="selected-item__grid">
          <NumberField label="Potencia continua" value={form.inverterRatedW} min={1} step={100} unit="W" onChange={(v) => set('inverterRatedW', v)} />
          <NumberField label="Potencia de arranque" value={form.inverterSurgeW} min={0} step={100} unit="W" onChange={(v) => set('inverterSurgeW', v)} />
          <NumberField label="Entrada PV máxima" value={form.inverterMaxPvInputW} min={0} step={100} unit="W" onChange={(v) => set('inverterMaxPvInputW', v)} />
          <NumberField label="Carga máxima" value={form.inverterChargeA} min={0} step={10} unit="A" onChange={(v) => set('inverterChargeA', v)} />
          <NumberField label="Descarga máxima" value={form.inverterDischargeA} min={0} step={10} unit="A" onChange={(v) => set('inverterDischargeA', v)} />
        </div>
        <Button full icon="shield" onClick={run} disabled={state.appliances.length === 0} style={{ marginTop: '1rem' }}>Analizar la oferta</Button>
      </Panel>

      {report && (
        <>
          <Panel tone="dark">
            <h3>Resultado del análisis</h3>
            <div className="stat-grid stat-grid--four" style={{ marginTop: '1rem' }}>
              <Stat tone="solar" value={`${Math.round(report.simulation.totals.coverage * 100)} %`} label="Cobertura simulada" />
              <Stat tone="storage" value={`${report.autonomyH.toFixed(1)} h`} label="Autonomía orientativa" />
              <Stat value={fmtW(report.simulation.totals.peakSurgeW)} label="Pico estimado de tu casa" />
              <Stat tone="demand" value={fmtKwh(report.simulation.totals.unservedKwh)} label="Energía no suministrada" />
            </div>
          </Panel>

          <Panel tone="paper">
            <h3>Datos que encajan</h3>
            {report.strengths.length ? (
              <ul style={{ paddingLeft: '1.1rem', fontSize: '.85rem' }}>{report.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            ) : <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>No hay suficientes datos para destacar puntos fuertes.</p>}
          </Panel>

          <Panel tone="paper">
            <h3>Limitaciones detectadas</h3>
            {report.limitations.length ? (
              <ul style={{ paddingLeft: '1.1rem', fontSize: '.85rem' }}>{report.limitations.map((s) => <li key={s}>{s}</li>)}</ul>
            ) : <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>No se han detectado limitaciones con los datos disponibles.</p>}
          </Panel>

          {report.missingData.length > 0 && (
            <Panel tone="paper">
              <h3>Datos pendientes de verificar</h3>
              <ul style={{ paddingLeft: '1.1rem', fontSize: '.85rem' }}>{report.missingData.map((s) => <li key={s}>{s}</li>)}</ul>
              <Note level="info">Pide la ficha técnica de cada equipo y comprueba que coincide con lo instalado. Un dato sin verificar no es necesariamente un error.</Note>
            </Panel>
          )}
        </>
      )}

      <Note level="warning" title="Informe independiente">
        Este análisis es orientativo y se basa en los datos introducidos y en las hipótesis de la calculadora. No sustituye la revisión de un técnico presencial.
      </Note>
    </>
  );
}
