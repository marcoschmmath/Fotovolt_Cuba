import { useState } from 'react';
import { useApp } from '../app/AppContext';
import type { BatterySpec, InverterSpec, PanelSpec } from '../domain/core/types';
import { CATALOG_SOURCES } from '../domain/catalog/verifiedEquipment';
import { SPEC_PROMPT } from '../domain/config/prompt';
import { uid } from '../domain/persistence/storage';
import { Badge, Button, Field, Note, NumberField, Panel, SectionTitle, TextField, fmtKwh, fmtMoney, fmtW } from '../ui/components';
import { Icon } from '../ui/icons';

type Kind = 'panels' | 'batteries' | 'inverters';
type Draft = Record<string, string | number>;

interface FieldDef { key: string; label: string; step?: number; unit?: string; hint?: string }

const FIELDS: Record<Kind, FieldDef[]> = {
  panels: [
    { key: 'powerW', label: 'Potencia', unit: 'W', step: 10 },
    { key: 'vmppV', label: 'Tensión Vmp', unit: 'V', step: 0.1 },
    { key: 'imppA', label: 'Corriente Imp', unit: 'A', step: 0.1 },
    { key: 'vocV', label: 'Tensión Voc', unit: 'V', step: 0.1 },
    { key: 'iscA', label: 'Corriente Isc', unit: 'A', step: 0.1 },
    { key: 'tempCoeffVoc', label: 'Coef. temp. Voc', step: 0.0001, hint: 'Por °C, normalmente negativo' },
    { key: 'tempCoeffPmpp', label: 'Coef. temp. potencia', step: 0.0001 },
    { key: 'noct', label: 'NOCT', unit: '°C' },
    { key: 'price', label: 'Precio (opcional)', step: 1 },
  ],
  batteries: [
    { key: 'nominalKwh', label: 'Capacidad', unit: 'kWh', step: 0.1 },
    { key: 'nominalV', label: 'Tensión nominal', unit: 'V' },
    { key: 'capacityAh', label: 'Capacidad', unit: 'Ah' },
    { key: 'maxChargeW', label: 'Carga máxima', unit: 'W', step: 100 },
    { key: 'maxDischargeW', label: 'Descarga máxima', unit: 'W', step: 100 },
    { key: 'dod', label: 'DoD', step: 0.05 },
    { key: 'chargeEff', label: 'Eficiencia de carga', step: 0.01 },
    { key: 'dischargeEff', label: 'Eficiencia de descarga', step: 0.01 },
    { key: 'price', label: 'Precio (opcional)', step: 1 },
  ],
  inverters: [
    { key: 'ratedW', label: 'Potencia continua', unit: 'W', step: 100 },
    { key: 'surgeW', label: 'Potencia de arranque', unit: 'W', step: 100 },
    { key: 'surgeSeconds', label: 'Segundos de sobrecarga' },
    { key: 'efficiency', label: 'Eficiencia', step: 0.01 },
    { key: 'maxPvInputW', label: 'Entrada PV máxima', unit: 'W', step: 100 },
    { key: 'maxPvVoltageV', label: 'Tensión PV máxima', unit: 'V' },
    { key: 'batteryVoltageV', label: 'Tensión de batería', unit: 'V' },
    { key: 'maxChargeA', label: 'Carga máxima', unit: 'A', step: 1 },
    { key: 'maxDischargeA', label: 'Descarga máxima', unit: 'A', step: 1 },
    { key: 'mpptMaxV', label: 'MPPT tensión máx.', unit: 'V' },
    { key: 'mpptMinV', label: 'MPPT tensión mín.', unit: 'V' },
    { key: 'mpptMaxA', label: 'MPPT corriente máx.', unit: 'A', step: 0.5 },
    { key: 'mpptMaxW', label: 'MPPT potencia máx.', unit: 'W', step: 100 },
    { key: 'price', label: 'Precio (opcional)', step: 1 },
  ],
};

function toDraft(kind: Kind, item: PanelSpec | BatterySpec | InverterSpec): Draft {
  const base: Draft = {
    brand: item.brand,
    model: item.model,
    currency: item.currency ?? 'USD',
  };
  if (kind === 'panels') {
    const p = item as PanelSpec;
    Object.assign(base, { powerW: p.powerW, vmppV: p.vmppV, imppA: p.imppA, vocV: p.vocV, iscA: p.iscA, tempCoeffVoc: p.tempCoeffVoc, tempCoeffPmpp: p.tempCoeffPmpp, noct: p.noct, price: p.price ?? '' });
  } else if (kind === 'batteries') {
    const b = item as BatterySpec;
    Object.assign(base, { nominalKwh: b.nominalKwh, nominalV: b.nominalV, capacityAh: b.capacityAh, maxChargeW: b.maxChargeW, maxDischargeW: b.maxDischargeW, dod: b.dod, chargeEff: b.chargeEff, dischargeEff: b.dischargeEff, chemistry: b.chemistry, price: b.price ?? '' });
  } else {
    const i = item as InverterSpec;
    const mppt = i.mppt[0];
    Object.assign(base, {
      ratedW: i.ratedW, surgeW: i.surgeW, surgeSeconds: i.surgeSeconds, efficiency: i.efficiency,
      maxPvInputW: i.maxPvInputW, maxPvVoltageV: i.maxPvVoltageV, batteryVoltageV: i.batteryVoltageV,
      maxChargeA: i.maxChargeA, maxDischargeA: i.maxDischargeA,
      mpptMaxV: mppt?.maxVoltageV ?? 0, mpptMinV: mppt?.minVoltageV ?? 0, mpptMaxA: mppt?.maxCurrentA ?? 0, mpptMaxW: mppt?.maxPowerW ?? 0,
      voltage: i.acVoltages.includes(220) ? '220' : '110',
      price: i.price ?? '',
    });
  }
  return base;
}

function fromDraft(kind: Kind, draft: Draft, id: string): PanelSpec | BatterySpec | InverterSpec {
  const num = (key: string) => Number(draft[key]) || 0;
  const optionalPrice = draft.price === '' || draft.price === undefined ? undefined : Number(draft.price);
  const common = {
    id,
    brand: String(draft.brand ?? ''),
    model: String(draft.model ?? 'Equipo sin nombre'),
    price: optionalPrice,
    currency: (draft.currency === 'CUP' ? 'CUP' : 'USD') as 'USD' | 'CUP',
    isReference: false,
    note: 'Datos introducidos por el instalador.',
  };
  if (kind === 'panels') {
    return {
      ...common,
      powerW: num('powerW'), vmppV: num('vmppV'), imppA: num('imppA'), vocV: num('vocV'), iscA: num('iscA'),
      tempCoeffVoc: num('tempCoeffVoc') || -0.003, tempCoeffPmpp: num('tempCoeffPmpp') || -0.0035, noct: num('noct') || 45,
    } as PanelSpec;
  }
  if (kind === 'batteries') {
    return {
      ...common,
      nominalKwh: num('nominalKwh'), nominalV: num('nominalV'), capacityAh: num('capacityAh'),
      maxChargeW: num('maxChargeW'), maxDischargeW: num('maxDischargeW'), dod: num('dod') || 0.8,
      chargeEff: num('chargeEff') || 0.95, dischargeEff: num('dischargeEff') || 0.95,
      chemistry: String(draft.chemistry ?? ''),
    } as BatterySpec;
  }
  const voltage = draft.voltage === '220' ? 220 : 110;
  return {
    ...common,
    ratedW: num('ratedW'), surgeW: num('surgeW'), surgeSeconds: num('surgeSeconds'), efficiency: num('efficiency') || 0.92,
    maxPvInputW: num('maxPvInputW'), maxPvVoltageV: num('maxPvVoltageV'), batteryVoltageV: num('batteryVoltageV'),
    maxChargeA: num('maxChargeA'), maxDischargeA: num('maxDischargeA'),
    mppt: [{ maxVoltageV: num('mpptMaxV'), minVoltageV: num('mpptMinV'), maxCurrentA: num('mpptMaxA'), maxPowerW: num('mpptMaxW') }],
    acVoltages: [voltage],
  } as InverterSpec;
}

function PromptCard() {
  return (
    <Panel tone="green">
      <div className="row">
        <span className="list-row__icon"><Icon name="spark" size={20} /></span>
        <div>
          <strong>¿No sabes qué valor poner?</strong>
          <p style={{ margin: '.25rem 0 0', fontSize: '.82rem' }}>
            Busca el modelo en Google o copia este prompt en una IA. Sustituye lo que está entre corchetes por los datos del equipo que piensas comprar.
          </p>
        </div>
      </div>
      <pre className="prompt-box">{SPEC_PROMPT}</pre>
      <Button variant="outline" icon="share" onClick={() => { void navigator.clipboard?.writeText(SPEC_PROMPT); }}>Copiar prompt</Button>
    </Panel>
  );
}

export function Catalog() {
  const { state, patch } = useApp();
  const [kind, setKind] = useState<Kind>('panels');
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const items = state[kind] as Array<PanelSpec | BatterySpec | InverterSpec>;

  function tryUnlock() {
    if (pinInput === state.commercial.pin) {
      setUnlocked(true);
      setPinError(false);
    } else setPinError(true);
  }

  function save() {
    if (!editing) return;
    const item = fromDraft(kind, editing, editingId ?? uid(kind));
    const list = state[kind] as Array<PanelSpec | BatterySpec | InverterSpec>;
    const next = editingId ? list.map((x) => (x.id === editingId ? item : x)) : [...list, item];
    if (kind === 'panels') patch({ panels: next as PanelSpec[], panelId: item.id });
    if (kind === 'batteries') patch({ batteries: next as BatterySpec[], batteryId: item.id });
    if (kind === 'inverters') patch({ inverters: next as InverterSpec[], inverterId: item.id });
    setEditing(null);
    setEditingId(null);
  }

  function remove(id: string) {
    if (items.length <= 1) return;
    const next = items.filter((x) => x.id !== id);
    if (kind === 'panels') patch({ panels: next as PanelSpec[], panelId: next[0].id });
    if (kind === 'batteries') patch({ batteries: next as BatterySpec[], batteryId: next[0].id });
    if (kind === 'inverters') patch({ inverters: next as InverterSpec[], inverterId: next[0].id });
  }

  return (
    <>
      <SectionTitle eyebrow="Tus equipos" title="Equipos que piensas comprar" description="Yo no vendo equipos: sólo monto lo que tú elijas. Añade aquí las características de los modelos que vas a comprar. Todo se guarda en este teléfono." />

      <PromptCard />

      <div className="segmented" role="group" aria-label="Tipo de equipo">
        {([['panels', 'Paneles'], ['batteries', 'Baterías'], ['inverters', 'Inversores']] as Array<[Kind, string]>).map(([value, label]) => (
          <button key={value} type="button" className={kind === value ? 'is-active' : ''} aria-pressed={kind === value} onClick={() => { setKind(value); setEditing(null); }}>{label}</button>
        ))}
      </div>

      {!unlocked ? (
        <Panel tone="paper" style={{ marginTop: '1rem' }}>
          <div className="row"><Icon name="lock" size={19} /><strong>Edición protegida</strong></div>
          <p style={{ color: 'var(--muted)', fontSize: '.82rem' }}>Introduce el PIN local para añadir o modificar equipos. Puedes cambiarlo en la sección Contacto.</p>
          <div className="row">
            <input type="password" inputMode="numeric" value={pinInput} placeholder="PIN" aria-label="PIN de administración" onChange={(e) => { setPinInput(e.target.value); setPinError(false); }} style={{ maxWidth: '8rem' }} />
            <Button onClick={tryUnlock}>Desbloquear</Button>
          </div>
          {pinError && <Note level="error">PIN incorrecto.</Note>}
        </Panel>
      ) : (
        <Panel tone="green" style={{ marginTop: '1rem' }}>
          <div className="row--between row">
            <span className="row"><Icon name="check" size={18} /> Edición desbloqueada</span>
            <Button variant="quiet" onClick={() => setUnlocked(false)}>Bloquear</Button>
          </div>
        </Panel>
      )}

      {unlocked && editing && (
        <Panel tone="paper">
          <h3>{editingId ? 'Editar equipo' : 'Nuevo equipo'}</h3>
          <div className="selected-item__grid">
            <TextField label="Marca" value={String(editing.brand ?? '')} onChange={(v) => setEditing({ ...editing, brand: v })} placeholder="Ej.: MUST" />
            <TextField label="Modelo" value={String(editing.model ?? '')} onChange={(v) => setEditing({ ...editing, model: v })} />
          </div>
          <div className="selected-item__grid" style={{ marginTop: '.5rem' }}>
            {FIELDS[kind].map((field) => (
              <NumberField key={field.key} label={field.label} value={Number(editing[field.key] ?? 0)} step={field.step ?? 1} unit={field.unit} hint={field.hint} onChange={(v) => setEditing({ ...editing, [field.key]: v })} />
            ))}
          </div>
          <div style={{ marginTop: '.6rem' }}>
            <Field label="Moneda del precio" htmlFor="currency">
              <select id="currency" value={String(editing.currency ?? 'USD')} onChange={(e) => setEditing({ ...editing, currency: e.target.value })}>
                <option value="USD">USD</option><option value="CUP">CUP</option>
              </select>
            </Field>
            {kind === 'batteries' && <TextField label="Química" value={String(editing.chemistry ?? '')} onChange={(v) => setEditing({ ...editing, chemistry: v })} />}
            {kind === 'inverters' && (
              <Field label="Tensión de salida" htmlFor="inv-voltage">
                <select id="inv-voltage" value={String(editing.voltage ?? '110')} onChange={(e) => setEditing({ ...editing, voltage: e.target.value })}>
                  <option value="110">110 V</option><option value="220">220 V</option>
                </select>
              </Field>
            )}
          </div>
          <Note level="info" title="Verifica la ficha técnica">
            Introduce sólo valores que consten en la ficha del fabricante. Un dato incorrecto puede invalidar las comprobaciones de compatibilidad.
          </Note>
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button icon="check" onClick={save} disabled={!String(editing.model ?? '').trim()}>Guardar equipo</Button>
          </div>
        </Panel>
      )}

      {unlocked && !editing && (
        <Button full icon="plus" onClick={() => setEditing(toDraft(kind, kind === 'panels' ? state.panels[0] : kind === 'batteries' ? state.batteries[0] : state.inverters[0]))}>Añadir modelo manualmente</Button>
      )}

      <Note level="info" title="Dónde buscar modelos">
        Algunos modelos de ejemplo ya están cargados con datos de fichas técnicas y su enlace de procedencia. La disponibilidad en Cuba cambia: confírmala antes de comprar. También puedes buscar tú mismo en Google con el prompt de arriba.
        <div className="row row--wrap" style={{ marginTop: '.5rem', gap: '.5rem' }}>
          {CATALOG_SOURCES.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="source-link">Ver tienda ↗</a>
          ))}
        </div>
      </Note>

      <div style={{ marginTop: '1rem' }}>
        {items.map((item) => {
          const selected = (kind === 'panels' ? state.panelId : kind === 'batteries' ? state.batteryId : state.inverterId) === item.id;
          const description = kind === 'panels'
            ? `${(item as PanelSpec).powerW} W · Voc ${(item as PanelSpec).vocV} V · Isc ${(item as PanelSpec).iscA} A`
            : kind === 'batteries'
              ? `${(item as BatterySpec).nominalKwh} kWh · ${(item as BatterySpec).nominalV} V · ${(item as BatterySpec).chemistry}`
              : `${fmtW((item as InverterSpec).ratedW)} · arranque ${fmtW((item as InverterSpec).surgeW)} · ${(item as InverterSpec).mppt.length} MPPT`;
          return (
            <Panel key={item.id} tone="paper">
              <div className="row">
                <div className="list-row__icon"><Icon name={kind === 'panels' ? 'sun' : kind === 'batteries' ? 'battery' : 'inverter'} size={20} /></div>
                <div className="list-row__main">
                  <strong>{[item.brand, item.model].filter(Boolean).join(' · ')}</strong>
                  <span>{description}</span>
                  <div className="row row--wrap" style={{ marginTop: '.35rem', gap: '.3rem' }}>
                    {selected && <Badge tone="solar">En uso</Badge>}
                    {item.isReference && <Badge tone="warning">Plantilla genérica</Badge>}
                    {item.sourceUrl && <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Ficha técnica ↗</a>}
                    {item.price !== undefined && <Badge>{fmtMoney(item.price, item.currency)}</Badge>}
                  </div>
                </div>
              </div>
              {unlocked && (
                <div className="row" style={{ marginTop: '.7rem' }}>
                  <Button variant="quiet" icon="settings" onClick={() => { setEditingId(item.id); setEditing(toDraft(kind, item)); }}>Editar</Button>
                  <Button variant="danger" icon="trash" onClick={() => remove(item.id)} disabled={items.length <= 1}>Eliminar</Button>
                </div>
              )}
              {item.note && <p style={{ fontSize: '.72rem', color: 'var(--muted)', margin: '.6rem 0 0' }}>{item.note}</p>}
            </Panel>
          );
        })}
      </div>
      {kind === 'batteries' && <Note level="info">Capacidad nominal de la plantilla de referencia: {fmtKwh(state.batteries[0].nominalKwh)}. Sustitúyela por tu modelo real.</Note>}
    </>
  );
}
