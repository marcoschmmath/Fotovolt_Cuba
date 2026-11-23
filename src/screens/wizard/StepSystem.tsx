import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import type { Calculation } from '../../app/useCalculation';
import { DEFAULT_PARAMS } from '../../domain/core/defaults';
import { SPEC_PROMPT } from '../../domain/config/prompt';
import type { DesignParams } from '../../domain/core/types';
import { checkStringDesign } from '../../domain/calculator/pv';
import { batteryPack } from '../../domain/calculator/battery';
import { Badge, Button, Field, Note, NumberField, Panel, RangeField, Stat, fmtKwh, fmtMoney, fmtW } from '../../ui/components';
import { Icon } from '../../ui/icons';

function Selector<T extends { id: string }>({ label, items, value, onChange, describe }: { label: string; items: T[]; value: string; onChange: (id: string) => void; describe: (item: T) => string }) {
  return (
    <Field label={label} htmlFor={`select-${label}`}>
      <select id={`select-${label}`} value={value} onChange={(e) => onChange(e.target.value)}>
        {items.map((item) => <option key={item.id} value={item.id}>{describe(item)}</option>)}
      </select>
    </Field>
  );
}

export function StepSystem({ calculation, onNext, onBack }: { calculation: Calculation; onNext: () => void; onBack: () => void }) {
  const { state, patch } = useApp();
  const [advanced, setAdvanced] = useState(false);
  const { sizing, panel, battery } = calculation;
  const pack = batteryPack(battery, sizing.batteryCount, state.params);
  const string = sizing.inverter ? checkStringDesign(panel, sizing.inverter, state.params) : null;

  function setParams(value: Partial<DesignParams>) {
    patch({ params: { ...state.params, ...value } });
  }

  return (
    <>
      <div className="section-title">
        <span className="eyebrow">Paso 3 de 4</span>
        <h2>Tu configuración de partida</h2>
        <p>El motor ya ha calculado el tamaño con tus datos. Ajusta los equipos y las hipótesis si lo necesitas.</p>
      </div>

      <Panel tone="dark">
        <div className="stat-grid">
          <Stat tone="solar" value={fmtW(sizing.targetPvW)} label="Potencia PV necesaria" sub={`${sizing.panelCount} paneles de ${panel.powerW} W`} />
          <Stat tone="storage" value={fmtKwh(sizing.targetBatteryKwh)} label="Capacidad nominal" sub={`${sizing.batteryCount} batería(s)`} />
          <Stat value={sizing.inverter ? fmtW(sizing.inverter.ratedW) : '—'} label="Inversor continuo" sub={sizing.inverter ? `Arranque ${fmtW(sizing.inverter.surgeW)}` : 'Sin opción válida'} />
          <Stat tone="demand" value={`${sizing.autonomyH.toFixed(1)} h`} label="Autonomía estimada" sub="Con la carga crítica actual" />
        </div>
        <div className="divider divider--light" />
        <div className="row row--wrap" style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
          <span>Potencia instalada: <strong style={{ color: 'var(--ink)' }}>{fmtW(sizing.panelCount * panel.powerW)}</strong></span>
          <span>Capacidad útil: <strong style={{ color: 'var(--storage)' }}>{pack.usableKwh.toFixed(2)} kWh</strong></span>
        </div>
      </Panel>

      <Panel tone="paper">
        <div className="panel__head"><h3>Equipos que piensas comprar</h3><Badge tone="storage">Los añades tú</Badge></div>
        <Note level="info" title="Si no sabes un parámetro, búscalo o pregunta a una IA">
          Copia este prompt en Google o en una IA, sustituyendo los corchetes por los datos del equipo:
          <pre className="prompt-box">{SPEC_PROMPT}</pre>
          <Button variant="outline" icon="share" onClick={() => { void navigator.clipboard?.writeText(SPEC_PROMPT); }}>Copiar prompt</Button>
        </Note>
        <Selector
          label="Panel fotovoltaico"
          items={state.panels}
          value={state.panelId}
          onChange={(panelId) => patch({ panelId })}
          describe={(p) => `${p.brand ? p.brand + ' · ' : ''}${p.model} · ${p.powerW} W${p.price !== undefined ? ` · ${fmtMoney(p.price, p.currency)}` : ''}`}
        />
        <Selector
          label="Batería"
          items={state.batteries}
          value={state.batteryId}
          onChange={(batteryId) => patch({ batteryId })}
          describe={(b) => `${b.brand ? b.brand + ' · ' : ''}${b.model} · ${b.nominalKwh} kWh${b.price !== undefined ? ` · ${fmtMoney(b.price, b.currency)}` : ''}`}
        />
        <Selector
          label="Inversor"
          items={state.inverters}
          value={state.inverterId}
          onChange={(inverterId) => patch({ inverterId })}
          describe={(i) => `${i.brand ? i.brand + ' · ' : ''}${i.model} · ${fmtW(i.ratedW)}${i.price !== undefined ? ` · ${fmtMoney(i.price, i.currency)}` : ''}`}
        />
        {sizing.inverter && sizing.inverter.id !== state.inverterId && (
          <Note level="warning" title="Inversor ajustado automáticamente">
            El modelo elegido no cumple todos los límites con tus equipos. El motor ha seleccionado {sizing.inverter.model} porque sí es compatible. Revisa las causas en «Observaciones del cálculo».
          </Note>
        )}
        <Note level="warning" title="Especificaciones de plantilla">
          Los modelos iniciales son genéricos y no pertenecen a ningún fabricante. Sustitúyelos por fichas técnicas reales desde Catálogo antes de recomendar una compra.
        </Note>
        <Button variant="quiet" full icon="catalog" onClick={() => { window.location.hash = '#/catalogo'; }}>Añadir o editar mis equipos</Button>
      </Panel>

      {sizing.inverterRejections.length > 0 && (
        <Panel tone="paper">
          <h3>Por qué no aparece un inversor válido</h3>
          <Note level="warning" title="No es un error de la app">
            Un inversor puede valer para la potencia media pero fallar en el arranque, la corriente de descarga o la tensión. El motor descarta cualquier modelo que exceda un límite técnico.
          </Note>
          {sizing.inverterRejections.map((rejection) => (
            <div className="list-row" key={rejection.id}>
              <div className="list-row__icon"><Icon name="warning" size={18} /></div>
              <div className="list-row__main">
                <strong>{rejection.model}</strong>
                {rejection.reasons.map((reason) => <span key={reason}>· {reason}</span>)}
              </div>
            </div>
          ))}
          {!sizing.inverter && (
            <Note level="error" title="Ningún modelo cumple">
              Añade un inversor compatible en «Añadir o editar mis equipos», o reduce los equipos de arranque en el paso 1.
            </Note>
          )}
        </Panel>
      )}

      {string && (
        <Panel tone="paper">
          <div className="panel__head"><h3>Comprobaciones eléctricas</h3><Badge tone={string.feasible ? 'solar' : 'warning'}>{string.feasible ? 'Verificado' : 'Revisar'}</Badge></div>
          <div className="stat-grid">
            <Stat value={`${string.minSeries}–${string.maxSeries}`} label="Placas en serie admitidas" />
            <Stat value={string.vocColdV.toFixed(1) + ' V'} label="Voc estimada en frío" sub="Hipótesis de temperatura" />
            <Stat value={string.maxParallelPerMppt.toString()} label="Strings por MPPT" />
            <Stat value={fmtW(sizing.panelCount * panel.powerW)} label="Array conectado" />
          </div>
          {string.violations.map((v) => <Note key={v} level="error">{v}</Note>)}
        </Panel>
      )}

      {sizing.diagnostics.length > 0 && (
        <Panel tone="paper">
          <h3>Observaciones del cálculo</h3>
          {sizing.diagnostics.map((d, i) => (
            <Note key={`${d.code}-${i}`} level={d.level === 'error' ? 'error' : d.level === 'warning' ? 'warning' : 'info'}>{d.message}</Note>
          ))}
        </Panel>
      )}

      <Panel tone="paper">
        <button type="button" className="row row--between" style={{ width: '100%', border: 0, background: 'none', padding: 0, color: 'inherit' }} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          <span className="row"><Icon name="slider" size={18} /> <strong>Hipótesis y parámetros</strong></span>
          <Icon name="chevron" size={16} style={{ transform: advanced ? 'rotate(90deg)' : 'none' }} />
        </button>
        {advanced && (
          <div style={{ marginTop: '1rem' }}>
            <RangeField label="Horas solares pico (HSP)" value={state.params.hsp} min={2} max={7} step={0.1} display={`${state.params.hsp.toFixed(1)} h`} hint="Hipótesis de irradiación diaria, no dato medido de tu localidad." onChange={(v) => setParams({ hsp: v })} />
            <RangeField label="Factor de seguridad" value={state.params.safetyFactor} min={1} max={1.6} step={0.05} display={`×${state.params.safetyFactor.toFixed(2)}`} onChange={(v) => setParams({ safetyFactor: v })} />
            <RangeField label="Eficiencia global del sistema" value={state.params.systemEfficiency} min={0.65} max={0.95} step={0.01} display={`${Math.round(state.params.systemEfficiency * 100)} %`} onChange={(v) => setParams({ systemEfficiency: v })} />
            <RangeField label="Profundidad de descarga (DoD)" value={state.params.dod} min={0.4} max={1} step={0.05} display={`${Math.round(state.params.dod * 100)} %`} onChange={(v) => setParams({ dod: v })} />
            <div className="selected-item__grid">
              <NumberField label="Temperatura ambiente" value={state.params.ambientC} min={-10} max={50} unit="°C" onChange={(v) => setParams({ ambientC: v })} />
              <NumberField label="Sombras y suciedad" value={state.params.shading} min={0} max={0.4} step={0.01} onChange={(v) => setParams({ shading: v })} />
              <NumberField label="Orientación e inclinación" value={state.params.tiltFactor} min={0.6} max={1} step={0.01} onChange={(v) => setParams({ tiltFactor: v })} />
              <NumberField label="Temperatura mínima" value={state.params.minAmbientC} min={-10} max={30} unit="°C" onChange={(v) => setParams({ minAmbientC: v })} />
            </div>
            <Button variant="quiet" full onClick={() => setParams({ ...DEFAULT_PARAMS, autonomyDays: state.params.autonomyDays })}>Restablecer hipótesis</Button>
          </div>
        )}
      </Panel>

      <div className="wizard-actions">
        <Button variant="quiet" onClick={onBack} icon="chevron">Atrás</Button>
        <Button onClick={onNext} icon="layers" trailing>Comparar opciones</Button>
      </div>
    </>
  );
}
