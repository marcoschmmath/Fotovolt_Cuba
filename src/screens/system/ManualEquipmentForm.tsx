import { useId, useState } from 'react';
import type { BatterySpec, InverterSpec, MpptSpec, PanelSpec } from '../../domain/core/types';
import { uid } from '../../domain/persistence/storage';
import { Button, Field, Note, Panel, TextField } from '../../ui/components';

type ManualKind = 'panels' | 'batteries' | 'inverters';
type ManualEquipment = PanelSpec | BatterySpec | InverterSpec;
type MpptDraft = Record<keyof MpptSpec, string>;

function blankMppt(): MpptDraft {
  return { maxVoltageV: '', minVoltageV: '', maxCurrentA: '', maxPowerW: '' };
}

function OptionalNumber({
  label,
  value,
  unit,
  hint,
  onChange,
  step = 'any',
  min = 0,
  max,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  onChange: (value: string) => void;
  step?: number | 'any';
  min?: number;
  max?: number;
}) {
  const id = useId();
  return (
    <Field label={`${label} · Opcional`} hint={hint} htmlFor={id}>
      <div className="number-field">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          placeholder="No disponible"
          onChange={(event) => onChange(event.target.value)}
        />
        {unit && <span className="number-field__unit">{unit}</span>}
      </div>
    </Field>
  );
}

function RequiredNumber({
  label,
  value,
  unit,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field label={`${label} · Necesario para simular`} hint={hint} htmlFor={id}>
      <div className="number-field">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="any"
          required
          value={value}
          placeholder="Introduce el valor"
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="number-field__unit">{unit}</span>
      </div>
    </Field>
  );
}

/**
 * Permite añadir un equipo no catalogado desde el flujo normal de instalación.
 * Los límites eléctricos avanzados son opcionales; nunca se inventan al guardar.
 */
export function ManualEquipmentForm({
  kind,
  onSave,
  onCancel,
}: {
  kind: ManualKind;
  onSave: (equipment: ManualEquipment) => void;
  onCancel: () => void;
}) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [chemistry, setChemistry] = useState('');
  const [mpptRows, setMpptRows] = useState<MpptDraft[]>([]);
  const [acVoltages, setAcVoltages] = useState<Array<110 | 220>>([]);
  const [error, setError] = useState('');

  const value = (key: string) => {
    const raw = values[key]?.trim() ?? '';
    if (raw === '') return 0;
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const setValue = (key: string, next: string) => setValues((current) => ({ ...current, [key]: next }));
  const common = {
    id: uid(kind),
    brand: brand.trim(),
    model: model.trim(),
    isReference: false,
    note: 'Equipo añadido por el usuario. Los datos técnicos no introducidos permanecen como desconocidos; SolarAPP emplea hipótesis explícitas sólo para los cálculos energéticos que lo permiten.',
  };

  function save() {
    if (!model.trim()) {
      setError('Escribe al menos el modelo del equipo.');
      return;
    }
    const optionalRules: Record<string, { min: number; max: number; label: string }> = kind === 'panels'
      ? {
          tempCoeffVoc: { min: -0.01, max: 0, label: 'coeficiente térmico Voc' },
          tempCoeffPmpp: { min: -0.01, max: 0, label: 'coeficiente térmico Pmax' },
          noct: { min: 20, max: 80, label: 'NOCT' },
        }
      : kind === 'batteries'
        ? {
            dod: { min: 0.01, max: 1, label: 'DoD' },
            chargeEff: { min: 0.5, max: 1, label: 'eficiencia de carga' },
            dischargeEff: { min: 0.5, max: 1, label: 'eficiencia de descarga' },
          }
        : { efficiency: { min: 0.5, max: 1, label: 'eficiencia del inversor' } };
    for (const [key, rawValue] of Object.entries(values)) {
      const raw = rawValue.trim();
      if (raw === '') continue;
      const parsed = Number(raw.replace(',', '.'));
      const allowsNegative = key === 'tempCoeffVoc' || key === 'tempCoeffPmpp';
      if (!Number.isFinite(parsed) || (!allowsNegative && parsed < 0)) {
        setError(`Revisa el valor de ${key}: debe ser un número válido y no negativo.`);
        return;
      }
    }
    for (const [key, rule] of Object.entries(optionalRules)) {
      const raw = values[key]?.trim() ?? '';
      if (raw !== '' && (value(key) < rule.min || value(key) > rule.max)) {
        setError(`El valor de ${rule.label} debe estar entre ${rule.min} y ${rule.max}.`);
        return;
      }
    }
    if (kind === 'inverters' && mpptRows.some((row) => {
      const min = Number(row.minVoltageV) || 0;
      const max = Number(row.maxVoltageV) || 0;
      return min > 0 && max > 0 && min > max;
    })) {
      setError('En una entrada MPPT, la tensión mínima no puede superar la máxima.');
      return;
    }

    if (kind === 'panels') {
      if (!(value('powerW') > 0)) {
        setError('La potencia nominal del panel es necesaria.');
        return;
      }
      const item: PanelSpec = {
        ...common,
        powerW: value('powerW'),
        vmppV: value('vmppV'),
        imppA: value('imppA'),
        vocV: value('vocV'),
        iscA: value('iscA'),
        tempCoeffVoc: value('tempCoeffVoc'),
        tempCoeffPmpp: value('tempCoeffPmpp'),
        noct: value('noct'),
      };
      onSave(item);
      return;
    }

    if (kind === 'batteries') {
      if (!(value('nominalKwh') > 0) || !(value('nominalV') > 0)) {
        setError('La capacidad en kWh y la tensión nominal son necesarias.');
        return;
      }
      const item: BatterySpec = {
        ...common,
        nominalKwh: value('nominalKwh'),
        nominalV: value('nominalV'),
        capacityAh: value('capacityAh'),
        maxChargeW: value('maxChargeW'),
        maxDischargeW: value('maxDischargeW'),
        dod: value('dod'),
        chargeEff: value('chargeEff'),
        dischargeEff: value('dischargeEff'),
        chemistry: chemistry.trim(),
      };
      onSave(item);
      return;
    }

    if (!(value('ratedW') > 0) || !(value('maxPvInputW') > 0) || !(value('batteryVoltageV') > 0)) {
      setError('La potencia continua, la potencia PV máxima y la tensión de batería son necesarias.');
      return;
    }

    const mppt: MpptSpec[] = mpptRows.map((row) => ({
      maxVoltageV: Number(row.maxVoltageV) || 0,
      minVoltageV: Number(row.minVoltageV) || 0,
      maxCurrentA: Number(row.maxCurrentA) || 0,
      maxPowerW: Number(row.maxPowerW) || 0,
    }));
    const item: InverterSpec = {
      ...common,
      ratedW: value('ratedW'),
      maxPvInputW: value('maxPvInputW'),
      batteryVoltageV: value('batteryVoltageV'),
      surgeW: value('surgeW'),
      surgeSeconds: value('surgeSeconds'),
      efficiency: value('efficiency'),
      maxPvVoltageV: value('maxPvVoltageV'),
      maxChargeA: value('maxChargeA'),
      maxDischargeA: value('maxDischargeA'),
      gridChargerW: value('gridChargerW'),
      mppt: mppt.filter((row) => Object.values(row).some((field) => field > 0)),
      acVoltages,
    };
    onSave(item);
  }

  return (
    <Panel tone="green" className="manual-equipment-form">
      <div className="panel__head">
        <h3>Añadir equipo que no aparece en el catálogo</h3>
        <BadgeText kind={kind} />
      </div>
      <p className="field__hint">Introduce los datos comerciales que conozcas. No hace falta tener una ficha técnica completa.</p>
      <div className="selected-item__grid">
        <TextField label="Marca (opcional)" value={brand} onChange={setBrand} placeholder="Ej.: MUST" />
        <TextField label="Nombre o modelo · Necesario" value={model} onChange={setModel} placeholder="Ej.: MUST híbrido 6 kW" />
      </div>

      {kind === 'panels' && (
        <>
          <RequiredNumber label="Potencia nominal" value={values.powerW ?? ''} unit="W" hint="Normalmente es el número grande de la etiqueta: 550 W, 590 W, 625 W…" onChange={(v) => setValue('powerW', v)} />
          <details className="catalog-optional-details">
            <summary><strong>Datos técnicos opcionales del panel</strong><span className="field__hint"> Puedes dejarlos vacíos.</span></summary>
            <div className="selected-item__grid" style={{ marginTop: '.65rem' }}>
              <OptionalNumber label="Vmp" value={values.vmppV ?? ''} unit="V" onChange={(v) => setValue('vmppV', v)} />
              <OptionalNumber label="Imp" value={values.imppA ?? ''} unit="A" onChange={(v) => setValue('imppA', v)} />
              <OptionalNumber label="Voc" value={values.vocV ?? ''} unit="V" onChange={(v) => setValue('vocV', v)} />
              <OptionalNumber label="Isc" value={values.iscA ?? ''} unit="A" onChange={(v) => setValue('iscA', v)} />
              <OptionalNumber label="Coeficiente térmico Voc" value={values.tempCoeffVoc ?? ''} min={-0.01} max={0} step={0.0001} onChange={(v) => setValue('tempCoeffVoc', v)} />
              <OptionalNumber label="Coeficiente térmico Pmax" value={values.tempCoeffPmpp ?? ''} min={-0.01} max={0} step={0.0001} onChange={(v) => setValue('tempCoeffPmpp', v)} />
              <OptionalNumber label="NOCT" value={values.noct ?? ''} unit="°C" onChange={(v) => setValue('noct', v)} />
            </div>
          </details>
        </>
      )}

      {kind === 'batteries' && (
        <>
          <div className="selected-item__grid">
            <RequiredNumber label="Capacidad nominal" value={values.nominalKwh ?? ''} unit="kWh" hint="Energía anunciada de la batería." onChange={(v) => setValue('nominalKwh', v)} />
            <RequiredNumber label="Tensión nominal" value={values.nominalV ?? ''} unit="V" hint="Por ejemplo: 12,8 V, 25,6 V o 51,2 V." onChange={(v) => setValue('nominalV', v)} />
          </div>
          <details className="catalog-optional-details">
            <summary><strong>Datos técnicos opcionales de la batería</strong><span className="field__hint"> Si faltan, SolarAPP estima límites conservadores.</span></summary>
            <TextField label="Química (opcional)" value={chemistry} onChange={setChemistry} placeholder="Ej.: LiFePO₄" />
            <div className="selected-item__grid" style={{ marginTop: '.65rem' }}>
              <OptionalNumber label="Capacidad" value={values.capacityAh ?? ''} unit="Ah" onChange={(v) => setValue('capacityAh', v)} />
              <OptionalNumber label="Potencia máxima de carga" value={values.maxChargeW ?? ''} unit="W" hint="Si falta, se estima a 0,2 C." onChange={(v) => setValue('maxChargeW', v)} />
              <OptionalNumber label="Potencia máxima de descarga" value={values.maxDischargeW ?? ''} unit="W" hint="Si falta, se estima a 0,2 C." onChange={(v) => setValue('maxDischargeW', v)} />
              <OptionalNumber label="DoD" value={values.dod ?? ''} min={0.01} max={1} step={0.01} hint="Fracción 0–1; por ejemplo 0,8." onChange={(v) => setValue('dod', v)} />
              <OptionalNumber label="Eficiencia de carga" value={values.chargeEff ?? ''} min={0.5} max={1} step={0.01} hint="Fracción 0–1; si falta se usa la hipótesis del sistema." onChange={(v) => setValue('chargeEff', v)} />
              <OptionalNumber label="Eficiencia de descarga" value={values.dischargeEff ?? ''} min={0.5} max={1} step={0.01} hint="Fracción 0–1; si falta se usa la hipótesis del sistema." onChange={(v) => setValue('dischargeEff', v)} />
            </div>
          </details>
        </>
      )}

      {kind === 'inverters' && (
        <>
          <div className="selected-item__grid">
            <RequiredNumber label="Potencia continua" value={values.ratedW ?? ''} unit="W" hint="La potencia nominal de salida del inversor, no la potencia pico." onChange={(v) => setValue('ratedW', v)} />
            <RequiredNumber label="Potencia PV máxima admitida" value={values.maxPvInputW ?? ''} unit="W" hint="Cuántos W de paneles permite conectar el fabricante o vendedor." onChange={(v) => setValue('maxPvInputW', v)} />
            <RequiredNumber label="Tensión del banco de baterías" value={values.batteryVoltageV ?? ''} unit="V" hint="Por ejemplo: 12, 24 o 48 V. Una batería de 51,2 V suele pertenecer a la clase de 48 V." onChange={(v) => setValue('batteryVoltageV', v)} />
          </div>
          <fieldset className="manual-voltage-fieldset">
            <legend className="field__label">Tensión de salida (opcional)</legend>
            <div className="row row--wrap">
              {([110, 220] as const).map((voltage) => (
                <label className="row" key={voltage}>
                  <input
                    type="checkbox"
                    checked={acVoltages.includes(voltage)}
                    onChange={(event) => setAcVoltages((current) => event.target.checked ? [...current, voltage] : current.filter((item) => item !== voltage))}
                  />
                  <span>{voltage} V</span>
                </label>
              ))}
            </div>
            <span className="field__hint">Si no lo conoces, déjalo sin marcar. La simulación energética puede continuar, pero la salida AC quedará sin verificar.</span>
          </fieldset>
          <details className="catalog-optional-details">
            <summary><strong>Datos técnicos opcionales del inversor</strong><span className="field__hint"> Incluye límites MPPT para comprobar automáticamente strings.</span></summary>
            <div className="selected-item__grid" style={{ marginTop: '.65rem' }}>
              <OptionalNumber label="Potencia de pico / arranque" value={values.surgeW ?? ''} unit="W" onChange={(v) => setValue('surgeW', v)} />
              <OptionalNumber label="Duración del pico" value={values.surgeSeconds ?? ''} unit="s" onChange={(v) => setValue('surgeSeconds', v)} />
              <OptionalNumber label="Eficiencia" value={values.efficiency ?? ''} min={0.5} max={1} step={0.01} hint="Fracción 0–1; si falta se usa la hipótesis de SolarAPP." onChange={(v) => setValue('efficiency', v)} />
              <OptionalNumber label="Tensión PV máxima absoluta" value={values.maxPvVoltageV ?? ''} unit="V" onChange={(v) => setValue('maxPvVoltageV', v)} />
              <OptionalNumber label="Corriente máxima de carga" value={values.maxChargeA ?? ''} unit="A" onChange={(v) => setValue('maxChargeA', v)} />
              <OptionalNumber label="Corriente máxima de descarga" value={values.maxDischargeA ?? ''} unit="A" onChange={(v) => setValue('maxDischargeA', v)} />
              <OptionalNumber label="Cargador desde la red" value={values.gridChargerW ?? ''} unit="W" hint="Si no se declara, SolarAPP no da por hecho que pueda cargar la batería desde la red." onChange={(v) => setValue('gridChargerW', v)} />
            </div>
            <div className="manual-mppt-list">
              <span className="field__label">Límites de cada entrada MPPT (opcionales)</span>
              <p className="field__hint">No estás configurando strings. Introduce sólo los límites que conozcas. SolarAPP utilizará para la comprobación las entradas que tengan completos sus cuatro límites; los datos parciales se conservan, pero no se consideran verificados.</p>
              {mpptRows.map((row, index) => (
                <div className="manual-mppt-row" key={index}>
                  <strong>Entrada MPPT {index + 1}</strong>
                  <div className="selected-item__grid">
                    <OptionalNumber label="Tensión máxima" value={row.maxVoltageV} unit="V" onChange={(v) => setMpptRows((current) => current.map((item, i) => i === index ? { ...item, maxVoltageV: v } : item))} />
                    <OptionalNumber label="Tensión mínima" value={row.minVoltageV} unit="V" onChange={(v) => setMpptRows((current) => current.map((item, i) => i === index ? { ...item, minVoltageV: v } : item))} />
                    <OptionalNumber label="Corriente máxima" value={row.maxCurrentA} unit="A" onChange={(v) => setMpptRows((current) => current.map((item, i) => i === index ? { ...item, maxCurrentA: v } : item))} />
                    <OptionalNumber label="Potencia máxima" value={row.maxPowerW} unit="W" onChange={(v) => setMpptRows((current) => current.map((item, i) => i === index ? { ...item, maxPowerW: v } : item))} />
                  </div>
                  <Button variant="quiet" onClick={() => setMpptRows((current) => current.filter((_, i) => i !== index))}>Quitar MPPT {index + 1}</Button>
                </div>
              ))}
              <Button variant="outline" icon="plus" onClick={() => setMpptRows((current) => [...current, blankMppt()])}>Añadir datos de otro MPPT</Button>
            </div>
          </details>
        </>
      )}

      {error && <Note level="error">{error}</Note>}
      <Note level="info" title="Datos desconocidos no bloquean la simulación">
        Los campos opcionales pueden quedar vacíos. SolarAPP aplicará hipótesis identificadas cuando sean razonables y marcará sin verificar las comprobaciones eléctricas que necesiten datos ausentes.
      </Note>
      <div className="wizard-actions">
        <Button variant="quiet" onClick={onCancel}>Cancelar</Button>
        <Button icon="check" onClick={save}>Guardar y seleccionar</Button>
      </div>
    </Panel>
  );
}

function BadgeText({ kind }: { kind: ManualKind }) {
  const label = kind === 'panels' ? 'Panel fotovoltaico' : kind === 'batteries' ? 'Batería' : 'Inversor';
  return <span className="badge badge--solar">{label}</span>;
}
