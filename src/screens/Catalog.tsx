import { useState } from 'react';
import { useApp } from '../app/AppContext';
import type { BatterySpec, InverterSpec, PanelSpec } from '../domain/core/types';
import { CATALOG_SOURCES } from '../domain/catalog/verifiedEquipment';
import { SPEC_PROMPT } from '../domain/config/prompt';
import { uid, type AppState } from '../domain/persistence/storage';
import { Badge, Button, Field, Note, NumberField, Panel, SectionTitle, TextField, Toast, useClipboard, fmtKwh, fmtMoney, fmtW } from '../ui/components';
import { Icon } from '../ui/icons';

type Kind = 'panels' | 'batteries' | 'inverters';
type Draft = Record<string, string | number | MpptRow[] | number[]>;

interface MpptRow { maxVoltageV: number; minVoltageV: number; maxCurrentA: number; maxPowerW: number }

interface FieldDef {
  key: string;
  label: string;
  step?: number;
  unit?: string;
  hint?: string;
  /** Mínimo explícito: permite negativos (coeficientes térmicos, C8). */
  min?: number;
  max?: number;
  required?: boolean;
}

const FIELDS: Record<Kind, FieldDef[]> = {
  panels: [
    { key: 'powerW', label: 'Potencia nominal', unit: 'W', step: 10, min: 1, required: true, hint: 'Dato básico: normalmente aparece en grande en la etiqueta (p. ej. 550 W).'},
    { key: 'vmppV', label: 'Tensión Vmp', unit: 'V', step: 0.1, min: 0, hint: 'Opcional: ayuda a verificar la tensión de trabajo de cada string.' },
    { key: 'imppA', label: 'Corriente Imp', unit: 'A', step: 0.1, min: 0, hint: 'Opcional: corriente en el punto de máxima potencia.' },
    { key: 'vocV', label: 'Tensión Voc', unit: 'V', step: 0.1, min: 0, hint: 'Opcional, pero necesaria junto con Vmp para comprobar strings y tensión máxima en frío.' },
    { key: 'iscA', label: 'Corriente Isc', unit: 'A', step: 0.1, min: 0, hint: 'Opcional: se utiliza para verificar la corriente admisible del MPPT.' },
    { key: 'tempCoeffVoc', label: 'Coef. temperatura Voc', step: 0.0001, min: -0.01, max: 0, hint: 'Opcional: por °C, normalmente negativo (p. ej. −0,0028).' },
    { key: 'tempCoeffPmpp', label: 'Coef. temperatura potencia', step: 0.0001, min: -0.01, max: 0, hint: 'Opcional: por °C, normalmente negativo (p. ej. −0,0035).' },
    { key: 'noct', label: 'NOCT', unit: '°C', min: 20, max: 80, hint: 'Opcional: si falta, se usa la hipótesis térmica general de SolarAPP.' },
    { key: 'price', label: 'Precio de referencia', unit: 'USD/CUP', step: 1, min: 0, hint: 'Opcional: precio observado o anunciado.' },
  ],
  batteries: [
    { key: 'nominalKwh', label: 'Capacidad nominal', unit: 'kWh', step: 0.1, min: 0.1, required: true, hint: 'Dato básico: energía nominal anunciada de la batería.' },
    { key: 'nominalV', label: 'Tensión nominal', unit: 'V', min: 1, required: true, hint: 'Dato básico: por ejemplo 12,8 V, 25,6 V o 51,2 V.' },
    { key: 'capacityAh', label: 'Capacidad', unit: 'Ah', min: 0, hint: 'Opcional: informativa; si ya conoces kWh no es necesaria para estimar energía.' },
    { key: 'maxChargeW', label: 'Potencia máxima de carga', unit: 'W', step: 100, min: 0, hint: 'Opcional: si no se conoce se estima un límite conservador de 0,2 C.' },
    { key: 'maxDischargeW', label: 'Potencia máxima de descarga', unit: 'W', step: 100, min: 0, hint: 'Opcional: si no se conoce se estima un límite conservador de 0,2 C.' },
    { key: 'dod', label: 'Profundidad de descarga (DoD)', step: 0.05, min: 0.05, max: 1, hint: 'Opcional: si no se conoce se utiliza la hipótesis de DoD de la instalación.' },
    { key: 'chargeEff', label: 'Eficiencia de carga', step: 0.01, min: 0.5, max: 1, hint: 'Opcional: si falta se utiliza la hipótesis general del sistema.' },
    { key: 'dischargeEff', label: 'Eficiencia de descarga', step: 0.01, min: 0.5, max: 1, hint: 'Opcional: si falta se utiliza la hipótesis general del sistema.' },
    { key: 'price', label: 'Precio de referencia', unit: 'USD/CUP', step: 1, min: 0, hint: 'Opcional: precio observado o anunciado.' },
  ],
  inverters: [
    { key: 'ratedW', label: 'Potencia continua', unit: 'W', step: 100, min: 1, required: true, hint: 'Dato básico: potencia nominal de salida del inversor.' },
    { key: 'maxPvInputW', label: 'Potencia fotovoltaica máxima admitida', unit: 'W', step: 100, min: 1, required: true, hint: 'Dato básico: cuántos W de paneles permite conectar el vendedor/fabricante.' },
    { key: 'batteryVoltageV', label: 'Tensión del banco de baterías', unit: 'V', min: 1, required: true, hint: 'Dato básico: clase de batería admitida (12, 24 o 48 V; 51,2 V corresponde normalmente a sistemas de 48 V).' },
    { key: 'surgeW', label: 'Potencia de arranque / pico', unit: 'W', step: 100, min: 0, hint: 'Opcional: si no se conoce, no se supone una capacidad de sobrecarga adicional.' },
    { key: 'surgeSeconds', label: 'Duración del pico', unit: 's', min: 0, hint: 'Opcional: duración admitida de la sobrecarga.' },
    { key: 'efficiency', label: 'Eficiencia máxima', step: 0.01, min: 0.5, max: 1, hint: 'Opcional: si falta se utiliza la hipótesis editable del sistema.' },
    { key: 'maxPvVoltageV', label: 'Tensión PV máxima absoluta', unit: 'V', min: 0, hint: 'Opcional para energía; necesaria para verificar que la serie no excede la tensión máxima.' },
    { key: 'maxChargeA', label: 'Corriente máxima de carga de batería', unit: 'A', step: 1, min: 0, hint: 'Opcional: si falta se limita por la hipótesis de potencia del BMS.' },
    { key: 'maxDischargeA', label: 'Corriente máxima de descarga de batería', unit: 'A', step: 1, min: 0, hint: 'Opcional: si falta se limita por la potencia estimada del BMS y la potencia AC del inversor.' },
    { key: 'gridChargerW', label: 'Potencia del cargador desde red', unit: 'W', step: 100, min: 0, hint: 'Opcional: si no se conoce, SolarAPP no supondrá que el inversor puede cargar la batería desde la red.' },
    { key: 'price', label: 'Precio de referencia', unit: 'USD/CUP', step: 1, min: 0, hint: 'Opcional: precio observado o anunciado.' },
  ],
};

function scalarFieldValue(value: unknown): string | number {
  return typeof value === 'string' || typeof value === 'number' ? value : '';
}

function CatalogNumberField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string | number;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label={`${field.label} · ${field.required ? 'Necesario para simular' : 'Opcional'}`}
      hint={field.hint}
    >
      <div className="number-field">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={String(value ?? '')}
          placeholder={field.required ? 'Introduce el valor' : 'No disponible'}
          aria-label={field.label}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.unit && <span className="number-field__unit">{field.unit}</span>}
      </div>
    </Field>
  );
}

function newDraft(kind: Kind): Draft {
  const blankFields = Object.fromEntries(FIELDS[kind].map((field) => [field.key, '']));
  const common: Draft = { brand: '', model: '', currency: 'USD', ...blankFields, price: '' };
  if (kind === 'batteries') common.chemistry = '';
  if (kind === 'inverters') {
    common.mppt = [];
    common.acVoltages = [];
  }
  return common;
}

function toDraft(kind: Kind, item: PanelSpec | BatterySpec | InverterSpec): Draft {
  const editable = (value: number) => value === 0 ? '' : String(value);
  const base: Draft = {
    brand: item.brand,
    model: item.model,
    currency: item.currency ?? 'USD',
  };
  if (kind === 'panels') {
    const p = item as PanelSpec;
    Object.assign(base, {
      powerW: editable(p.powerW), vmppV: editable(p.vmppV), imppA: editable(p.imppA),
      vocV: editable(p.vocV), iscA: editable(p.iscA), tempCoeffVoc: editable(p.tempCoeffVoc),
      tempCoeffPmpp: editable(p.tempCoeffPmpp), noct: editable(p.noct), price: p.price ?? '',
    });
  } else if (kind === 'batteries') {
    const b = item as BatterySpec;
    Object.assign(base, {
      nominalKwh: editable(b.nominalKwh), nominalV: editable(b.nominalV), capacityAh: editable(b.capacityAh),
      maxChargeW: editable(b.maxChargeW), maxDischargeW: editable(b.maxDischargeW), dod: editable(b.dod),
      chargeEff: editable(b.chargeEff), dischargeEff: editable(b.dischargeEff), chemistry: b.chemistry, price: b.price ?? '',
    });
  } else {
    const i = item as InverterSpec;
    const mppt: MpptRow[] = i.mppt.map((m) => ({
      maxVoltageV: m.maxVoltageV, minVoltageV: m.minVoltageV, maxCurrentA: m.maxCurrentA, maxPowerW: m.maxPowerW,
    }));
    Object.assign(base, {
      ratedW: editable(i.ratedW), surgeW: editable(i.surgeW), surgeSeconds: editable(i.surgeSeconds),
      efficiency: editable(i.efficiency), maxPvInputW: editable(i.maxPvInputW),
      maxPvVoltageV: editable(i.maxPvVoltageV), batteryVoltageV: editable(i.batteryVoltageV),
      maxChargeA: editable(i.maxChargeA), maxDischargeA: editable(i.maxDischargeA),
      gridChargerW: editable(i.gridChargerW ?? 0),
      mppt, acVoltages: [...i.acVoltages], price: i.price ?? '',
    });
  }
  return base;
}

/** Número del borrador; `''` = no introducido (no se convierte en 0). */
function draftNum(draft: Draft, key: string, fallback: number): number {
  const raw = draft[key];
  if (raw === '' || raw === undefined || raw === null) return fallback;
  const parsed = Number(String(raw).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Igual que `draftNum`, para una fila del editor de MPPT. */
function rowNum(row: MpptRow, key: keyof MpptRow, fallback = 0): number {
  const parsed = Number(String(row[key] ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fromDraft(kind: Kind, draft: Draft, id: string): PanelSpec | BatterySpec | InverterSpec {
  const num = (key: string) => draftNum(draft, key, 0);
  const priceRaw = String(draft.price ?? '').trim();
  const optionalPrice = priceRaw === '' ? undefined : Number(priceRaw.replace(',', '.'));
  const common = {
    id,
    brand: String(draft.brand ?? '').trim(),
    model: String(draft.model ?? 'Equipo sin nombre').trim(),
    price: Number.isFinite(optionalPrice) ? Math.max(0, optionalPrice as number) : undefined,
    currency: (draft.currency === 'CUP' ? 'CUP' : 'USD') as 'USD' | 'CUP',
    isReference: false,
    note: 'Datos introducidos por el usuario. Los campos opcionales vacíos permanecen como desconocidos; SolarAPP aplica hipótesis sólo a los parámetros energéticos que lo permiten.',
  };
  if (kind === 'panels') {
    return {
      ...common,
      powerW: num('powerW'), vmppV: num('vmppV'), imppA: num('imppA'), vocV: num('vocV'), iscA: num('iscA'),
      tempCoeffVoc: num('tempCoeffVoc'), tempCoeffPmpp: num('tempCoeffPmpp'), noct: num('noct'),
    } as PanelSpec;
  }
  if (kind === 'batteries') {
    return {
      ...common,
      nominalKwh: num('nominalKwh'), nominalV: num('nominalV'), capacityAh: num('capacityAh'),
      maxChargeW: num('maxChargeW'), maxDischargeW: num('maxDischargeW'), dod: num('dod'),
      chargeEff: num('chargeEff'), dischargeEff: num('dischargeEff'),
      chemistry: String(draft.chemistry ?? '').trim(),
    } as BatterySpec;
  }
  const mppt = (Array.isArray(draft.mppt) ? (draft.mppt as MpptRow[]) : [])
    .map((m) => ({
      maxVoltageV: Math.max(0, rowNum(m, 'maxVoltageV')),
      minVoltageV: Math.max(0, rowNum(m, 'minVoltageV')),
      maxCurrentA: Math.max(0, rowNum(m, 'maxCurrentA')),
      maxPowerW: Math.max(0, rowNum(m, 'maxPowerW')),
    }))
    .filter((m) => m.maxVoltageV > 0 || m.minVoltageV > 0 || m.maxCurrentA > 0 || m.maxPowerW > 0);
  const voltages = Array.isArray(draft.acVoltages) ? (draft.acVoltages as number[]) : [];
  const acVoltages = [...new Set(voltages.filter((v) => v === 110 || v === 220))].sort() as Array<110 | 220>;
  return {
    ...common,
    ratedW: num('ratedW'), surgeW: num('surgeW'), surgeSeconds: num('surgeSeconds'), efficiency: num('efficiency'),
    maxPvInputW: num('maxPvInputW'), maxPvVoltageV: num('maxPvVoltageV'), batteryVoltageV: num('batteryVoltageV'),
    maxChargeA: num('maxChargeA'), maxDischargeA: num('maxDischargeA'),
    gridChargerW: num('gridChargerW'),
    mppt,
    acVoltages,
  } as InverterSpec;
}

/**
 * Validación de catálogo (M8): un producto inválido no se puede guardar ni
 * seleccionar. Antes un panel con `powerW = 0` se guardaba y el dimensionado
 * proponía miles de placas.
 */
function validateDraft(kind: Kind, draft: Draft): string[] {
  const errors: string[] = [];
  const value = (key: string) => draftNum(draft, key, Number.NaN);
  for (const field of FIELDS[kind].filter((item) => !item.required)) {
    const raw = String(draft[field.key] ?? '').trim();
    if (raw === '') continue;
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      errors.push(`${field.label}: introduce un número válido.`);
      continue;
    }
    if (field.min !== undefined && parsed < field.min) errors.push(`${field.label}: el mínimo es ${field.min}.`);
    if (field.max !== undefined && parsed > field.max) errors.push(`${field.label}: el máximo es ${field.max}.`);
  }
  if (!String(draft.model ?? '').trim()) errors.push('Escribe el modelo del equipo.');
  if (kind === 'panels') {
    if (!(value('powerW') > 0)) errors.push('La potencia nominal del panel es necesaria y debe ser mayor que 0 W.');
  }
  if (kind === 'batteries') {
    if (!(value('nominalKwh') > 0)) errors.push('La capacidad nominal es necesaria y debe ser mayor que 0 kWh.');
    if (!(value('nominalV') > 0)) errors.push('La tensión nominal es necesaria y debe ser mayor que 0 V.');
  }
  if (kind === 'inverters') {
    if (!(value('ratedW') > 0)) errors.push('La potencia continua es necesaria y debe ser mayor que 0 W.');
    if (!(value('maxPvInputW') > 0)) errors.push('La potencia fotovoltaica máxima admitida es necesaria para dimensionar el campo solar.');
    if (!(value('batteryVoltageV') > 0)) errors.push('La tensión nominal del banco de baterías es necesaria.');
    const mppt = Array.isArray(draft.mppt) ? (draft.mppt as MpptRow[]) : [];
    if (mppt.some((m) => Number(m.minVoltageV) > 0 && Number(m.maxVoltageV) > 0 && Number(m.minVoltageV) > Number(m.maxVoltageV))) {
      errors.push('En un MPPT la tensión mínima no puede superar la máxima.');
    }
    // La tensión AC puede quedar desconocida: en ese caso la simulación
    // energética continúa, pero la compatibilidad de salida no se verifica.
  }
  return errors;
}

function catalogDataQuality(kind: Kind, item: PanelSpec | BatterySpec | InverterSpec): { label: string; tone: 'solar' | 'warning' } {
  if (kind === 'panels') {
    const panel = item as PanelSpec;
    if (!(panel.powerW > 0)) return { label: 'Faltan datos básicos', tone: 'warning' };
    const electrical = panel.vocV > 0 && panel.vmppV > 0 && (panel.iscA > 0 || panel.imppA > 0);
    return electrical
      ? { label: 'Simulable · conexión comprobable', tone: 'solar' }
      : { label: 'Simulable · conexión pendiente', tone: 'warning' };
  }

  if (kind === 'batteries') {
    const battery = item as BatterySpec;
    if (!(battery.nominalKwh > 0) || !(battery.nominalV > 0)) return { label: 'Faltan datos básicos', tone: 'warning' };
    const declaredLimits = battery.maxChargeW > 0 && battery.maxDischargeW > 0 && battery.dod > 0 && battery.chargeEff > 0 && battery.dischargeEff > 0;
    return declaredLimits
      ? { label: 'Simulable · límites declarados', tone: 'solar' }
      : { label: 'Simulable · límites estimados', tone: 'warning' };
  }

  const inverter = item as InverterSpec;
  if (!(inverter.ratedW > 0) || !(inverter.maxPvInputW > 0) || !(inverter.batteryVoltageV > 0)) {
    return { label: 'Faltan datos básicos', tone: 'warning' };
  }
  const completeMppt = inverter.mppt.some((mppt) =>
    mppt.maxVoltageV > 0 && mppt.minVoltageV > 0 && mppt.maxCurrentA > 0 && mppt.maxPowerW > 0,
  );
  const electrical = inverter.maxPvVoltageV > 0 && completeMppt && inverter.acVoltages.length > 0;
  return electrical
    ? { label: 'Simulable · datos eléctricos ampliados', tone: 'solar' }
    : { label: 'Simulable · verificación parcial', tone: 'warning' };
}

function PromptCard() {
  const clipboard = useClipboard();
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
      <Button variant="outline" icon="share" onClick={() => clipboard.copy(SPEC_PROMPT)}>Copiar prompt</Button>
      <Toast message={clipboard.message} tone={clipboard.error ? 'error' : 'info'} />
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
  const clipboard = useClipboard();

  const items = state[kind] as Array<PanelSpec | BatterySpec | InverterSpec>;
  // La selección pertenece a la instalación activa: el catálogo sólo la
  // muestra, no la modifica. Sin instalación activa no hay «en uso».
  const activeSystem = state.installations.find((i) => i.id === state.activeInstallationId) ?? null;
  const selectedId = activeSystem
    ? kind === 'panels'
      ? activeSystem.panelId
      : kind === 'batteries'
        ? activeSystem.batteryId
        : activeSystem.inverterId
    : '';
  const isNew = editing !== null && editingId === null;
  const errors = editing ? validateDraft(kind, editing) : [];

  function tryUnlock() {
    if (pinInput === state.commercial.pin) {
      setUnlocked(true);
      setPinError(false);
    } else setPinError(true);
  }

  function save() {
    if (!editing || errors.length > 0) return;
    const item = fromDraft(kind, editing, editingId ?? uid(kind));
    const list = state[kind] as Array<PanelSpec | BatterySpec | InverterSpec>;
    const next = editingId ? list.map((x) => (x.id === editingId ? item : x)) : [...list, item];
    // M7: editar un equipo NO seleccionado no cambia la selección activa, y
    // eliminar sólo la cambia si el eliminado era el seleccionado. Un equipo
    // nuevo sí se selecciona: es la elección que el usuario acaba de hacer.
    const affectsSelection = isNew || editingId === selectedId;
    const selectionPatch = affectsSelection
      ? kind === 'panels'
        ? { panelId: item.id }
        : kind === 'batteries'
          ? { batteryId: item.id }
          : { inverterId: item.id }
      : {};
    const payload = kind === 'panels' ? { panels: next as PanelSpec[] } : kind === 'batteries' ? { batteries: next as BatterySpec[] } : { inverters: next as InverterSpec[] };
    patch({ ...payload, ...selectionPatch } as Partial<AppState>);
    setEditing(null);
    setEditingId(null);
  }

  function remove(id: string) {
    if (items.length <= 1) return;
    const next = items.filter((x) => x.id !== id);
    const payload = kind === 'panels' ? { panels: next as PanelSpec[] } : kind === 'batteries' ? { batteries: next as BatterySpec[] } : { inverters: next as InverterSpec[] };
    const selectionPatch =
      id === selectedId
        ? kind === 'panels'
          ? { panelId: next[0].id }
          : kind === 'batteries'
            ? { batteryId: next[0].id }
            : { inverterId: next[0].id }
        : {};
    patch({ ...payload, ...selectionPatch } as Partial<AppState>);
  }

  return (
    <>
      <SectionTitle eyebrow="Tus equipos" title="Equipos que piensas comprar" description="Yo no vendo equipos: sólo monto lo que tú elijas. Añade aquí los datos básicos que conozcas de los modelos que vas a comprar. Los detalles técnicos avanzados son opcionales y pueden completarse después. Todo se guarda en este teléfono." />

      <PromptCard />
      <Toast message={clipboard.message} tone={clipboard.error ? 'error' : 'info'} />

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
          <div style={{ marginTop: '.65rem' }}>
            <h4 style={{ marginBottom: '.35rem' }}>Datos básicos necesarios para simular</h4>
            <p className="field__hint">Con estos datos SolarAPP puede estimar producción, almacenamiento y potencia disponible. El resto puede añadirse más adelante.</p>
            <div className="selected-item__grid">
              {FIELDS[kind].filter((field) => field.required).map((field) => (
                <CatalogNumberField
                  key={field.key}
                  field={field}
                  value={scalarFieldValue(editing[field.key])}
                  onChange={(v) => setEditing({ ...editing, [field.key]: v })}
                />
              ))}
            </div>
          </div>
          <details className="catalog-optional-details" style={{ marginTop: '.9rem' }}>
            <summary><strong>Datos técnicos opcionales</strong><span className="field__hint"> Puedes dejarlos vacíos si el vendedor no los facilita.</span></summary>
            <div className="selected-item__grid" style={{ marginTop: '.65rem' }}>
              {FIELDS[kind].filter((field) => !field.required).map((field) => (
                <CatalogNumberField
                  key={field.key}
                  field={field}
                  value={scalarFieldValue(editing[field.key])}
                  onChange={(v) => setEditing({ ...editing, [field.key]: v })}
                />
              ))}
            </div>
            {kind === 'inverters' && (
              <div style={{ marginTop: '.7rem' }}>
                <span className="field__label">Datos de las entradas MPPT (opcionales)</span>
                <p className="field__hint">No configures aquí los strings. Puedes guardar sólo los límites que conozcas; SolarAPP comprobará una distribución automática usando las entradas MPPT que tengan todos sus límites declarados.</p>
                {(() => {
                  const rows = Array.isArray(editing.mppt) ? (editing.mppt as MpptRow[]) : [];
                  return (
                    <>
                      {rows.map((row, index) => (
                        <div key={index} className="selected-item__grid" style={{ marginTop: '.4rem' }}>
                          <NumberField label={`MPPT ${index + 1}: tensión máx.`} value={row.maxVoltageV} min={0} unit="V" onChange={(v) => setEditing({ ...editing, mppt: rows.map((m, i) => (i === index ? { ...m, maxVoltageV: v } : m)) })} />
                          <NumberField label={`MPPT ${index + 1}: tensión mín.`} value={row.minVoltageV} min={0} unit="V" onChange={(v) => setEditing({ ...editing, mppt: rows.map((m, i) => (i === index ? { ...m, minVoltageV: v } : m)) })} />
                          <NumberField label={`MPPT ${index + 1}: corriente máx.`} value={row.maxCurrentA} min={0} unit="A" onChange={(v) => setEditing({ ...editing, mppt: rows.map((m, i) => (i === index ? { ...m, maxCurrentA: v } : m)) })} />
                          <NumberField label={`MPPT ${index + 1}: potencia máx.`} value={row.maxPowerW} min={0} unit="W" onChange={(v) => setEditing({ ...editing, mppt: rows.map((m, i) => (i === index ? { ...m, maxPowerW: v } : m)) })} />
                        </div>
                      ))}
                      <div className="row" style={{ marginTop: '.5rem' }}>
                        <Button variant="quiet" icon="plus" onClick={() => setEditing({ ...editing, mppt: [...rows, { maxVoltageV: 0, minVoltageV: 0, maxCurrentA: 0, maxPowerW: 0 }] })}>Añadir datos de un MPPT</Button>
                        {rows.length > 0 && <Button variant="danger" icon="trash" onClick={() => setEditing({ ...editing, mppt: [] })}>Borrar datos MPPT</Button>}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </details>
          <div style={{ marginTop: '.6rem' }}>
            <Field label="Moneda del precio" htmlFor="currency">
              <select id="currency" value={String(editing.currency ?? 'USD')} onChange={(e) => setEditing({ ...editing, currency: e.target.value })}>
                <option value="USD">USD</option><option value="CUP">CUP</option>
              </select>
            </Field>
            {kind === 'batteries' && <TextField label="Química" value={String(editing.chemistry ?? '')} onChange={(v) => setEditing({ ...editing, chemistry: v })} />}
            {kind === 'inverters' && (
              <fieldset style={{ border: 0, padding: 0, margin: '.4rem 0 0' }}>
                <legend className="field__label">Tensiones de salida que admite (opcional)</legend>
                <p className="field__hint">Déjalo sin marcar si no conoces este dato. La simulación energética podrá continuar, pero no se verificará la salida AC.</p>
                <div className="row row--wrap" style={{ gap: '1rem' }}>
                  {([110, 220] as const).map((voltage) => {
                    const selected = Array.isArray(editing.acVoltages) && (editing.acVoltages as number[]).includes(voltage);
                    return (
                      <label key={voltage} className="row" style={{ fontSize: '.86rem' }}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => {
                            const current = Array.isArray(editing.acVoltages) ? ([...editing.acVoltages] as number[]) : [];
                            const nextValues = event.target.checked
                              ? [...new Set([...current, voltage])]
                              : current.filter((v) => v !== voltage);
                            setEditing({ ...editing, acVoltages: nextValues });
                          }}
                        />
                        <span>{voltage} V</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
          {errors.length > 0 && (
            <Note level="error" title="Corrige estos datos antes de guardar">
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </Note>
          )}
          <Note level="info" title="Verifica la ficha técnica">
            Introduce primero los datos básicos que conozcas. Los campos opcionales pueden quedar vacíos: SolarAPP usará hipótesis explícitas para la simulación energética y dejará sin verificar las comprobaciones eléctricas que necesiten esos datos.
          </Note>
          <div className="wizard-actions">
            <Button variant="quiet" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button icon="check" onClick={save} disabled={errors.length > 0}>Guardar equipo</Button>
          </div>
        </Panel>
      )}

      {unlocked && !editing && (
        <Button full icon="plus" onClick={() => setEditing(newDraft(kind))}>Añadir modelo manualmente</Button>
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
          const selected = selectedId === item.id;
          const description = kind === 'panels'
            ? `${(item as PanelSpec).powerW} W · Voc ${(item as PanelSpec).vocV > 0 ? `${(item as PanelSpec).vocV} V` : 'no declarada'} · Isc ${(item as PanelSpec).iscA > 0 ? `${(item as PanelSpec).iscA} A` : 'no declarada'}`
            : kind === 'batteries'
              ? `${(item as BatterySpec).nominalKwh} kWh · ${(item as BatterySpec).nominalV} V · ${(item as BatterySpec).chemistry || 'química no declarada'}`
              : `${fmtW((item as InverterSpec).ratedW)} · pico ${(item as InverterSpec).surgeW > 0 ? fmtW((item as InverterSpec).surgeW) : 'no declarado'} · ${(item as InverterSpec).mppt.length > 0 ? `${(item as InverterSpec).mppt.length} MPPT con datos` : 'MPPT sin verificar'}`;
          const quality = catalogDataQuality(kind, item);
          return (
            <Panel key={item.id} tone="paper">
              <div className="row">
                <div className="list-row__icon"><Icon name={kind === 'panels' ? 'sun' : kind === 'batteries' ? 'battery' : 'inverter'} size={20} /></div>
                <div className="list-row__main">
                  <strong>{[item.brand, item.model].filter(Boolean).join(' · ')}</strong>
                  <span>{description}</span>
                  <div className="row row--wrap" style={{ marginTop: '.35rem', gap: '.3rem' }}>
                    <Badge tone={quality.tone}>{quality.label}</Badge>
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
