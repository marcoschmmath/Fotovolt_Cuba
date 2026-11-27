/**
 * Informe de una oferta comercial introducida por el usuario.
 *
 * Una oferta se simula EXACTAMENT igual que una instalación diseñada en la
 * app: mismo motor, mismos 24 escenarios, mismos comportamientos de cocción.
 * Lo que cambia es que los datos vienen del vendedor y pueden faltar.
 *
 * Regla de honestidad (§10.2): lo que no se declara, no se inventa. La
 * compatibilidad eléctrica queda «sin verificar» cuando falta un dato
 * imprescindible, aunque la simulación energética se complete con las
 * hipótesis declaradas.
 */

import type { BatterySpec, DesignParams, Diagnostic, InverterSpec, PanelSpec } from '../core/types';
import { checkInverterCompatibility } from '../calculator/inverter';
import { checkBalancedArrayConfiguration } from '../calculator/pv';
import { analyzeEnergy, buildDailyDemand, peakDesignW } from '../calculator/energy';
import { systemParams, type SystemConfiguration } from '../system/types';
import { effectivePriority } from '../household/types';
import type { HouseholdProfile } from '../household/types';

/** Equipo ofertado, tal y como lo introduce el usuario. */
export interface OfferEquipmentForm {
  panelCount: number;
  panelW: number;
  panelVocV: number;
  panelVmppV: number;
  panelIscA: number;
  panelImppA: number;
  panelTempCoeffVoc: number;
  panelTempCoeffPmpp: number;
  panelNoct: number;
  batteryCount: number;
  batteryKwhEach: number;
  batteryV: number;
  batteryCapacityAh: number;
  batteryMaxDischargeW: number;
  batteryMaxChargeW: number;
  batteryDod: number;
  batteryChargeEff: number;
  batteryDischargeEff: number;
  inverterRatedW: number;
  inverterSurgeW: number;
  inverterMaxPvInputW: number;
  inverterEfficiency: number;
  inverterMaxChargeA: number;
  inverterMaxDischargeA: number;
  inverterBatteryVoltageV: number;
  /** Potencia de cargador AC declarada. 0 o vacío = no carga desde red. */
  inverterGridChargerW: number;
  mpptMaxV: number;
  mpptMinV: number;
  mpptMaxA: number;
  mpptMaxW: number;
}

export interface OfferCompatibilityReport {
  /** true sólo si TODO lo imprescindible está declarado y verificado. */
  verified: boolean;
  diagnostics: Diagnostic[];
  /** Datos que faltan para poder verificar la instalación. */
  missing: string[];
}

/** Especificaciones construidas desde el formulario, con lo declarado. */
export function buildOfferSpecs(form: OfferEquipmentForm): {
  panel: PanelSpec;
  battery: BatterySpec;
  inverter: InverterSpec;
} {
  const note = 'Equipo introducido desde una oferta. Sin ficha técnica verificada.';
  const declared = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  return {
    panel: {
      id: 'oferta-panel',
      brand: '',
      model: 'Panel ofertado',
      powerW: Math.max(0, form.panelW),
      vmppV: declared(form.panelVmppV),
      imppA: declared(form.panelImppA),
      vocV: declared(form.panelVocV),
      iscA: declared(form.panelIscA),
      tempCoeffVoc: form.panelTempCoeffVoc,
      tempCoeffPmpp: form.panelTempCoeffPmpp,
      noct: declared(form.panelNoct) || 45, // 45 = plantilla; si no declaró, queda en `missing`
      isReference: false,
      note,
    },
    battery: {
      id: 'oferta-bateria',
      brand: '',
      model: 'Batería ofertada',
      nominalKwh: Math.max(0.01, form.batteryKwhEach),
      nominalV: Math.max(1, form.batteryV),
      capacityAh: Math.max(0, form.batteryCapacityAh),
      maxChargeW: Math.max(0, form.batteryMaxChargeW),
      maxDischargeW: Math.max(0, form.batteryMaxDischargeW),
      dod: Math.min(1, Math.max(0.05, form.batteryDod)),
      chargeEff: Math.min(1, Math.max(0.5, form.batteryChargeEff)),
      dischargeEff: Math.min(1, Math.max(0.5, form.batteryDischargeEff)),
      chemistry: '',
      isReference: false,
      note,
    },
    inverter: {
      id: 'oferta-inversor',
      brand: '',
      model: 'Inversor ofertado',
      ratedW: Math.max(1, form.inverterRatedW),
      surgeW: Math.max(1, form.inverterSurgeW),
      surgeSeconds: 5,
      efficiency: Math.min(1, Math.max(0.5, form.inverterEfficiency)),
      maxPvInputW: Math.max(0, form.inverterMaxPvInputW),
      maxPvVoltageV: declared(form.mpptMaxV),
      mppt: [
        {
          maxVoltageV: declared(form.mpptMaxV),
          minVoltageV: declared(form.mpptMinV),
          maxCurrentA: declared(form.mpptMaxA),
          maxPowerW: declared(form.mpptMaxW),
        },
      ],
      batteryVoltageV: Math.max(1, form.inverterBatteryVoltageV),
      maxChargeA: Math.max(0, form.inverterMaxChargeA),
      maxDischargeA: Math.max(0, form.inverterMaxDischargeA),
      gridChargerW: declared(form.inverterGridChargerW) || undefined,
      acVoltages: [110, 220],
      isReference: false,
      note,
    },
  };
}

/** Configuración de instalación a partir de la oferta (guarda como instalación). */
export function offerToSystem(form: OfferEquipmentForm, householdProfileId: string, name: string, params: DesignParams): SystemConfiguration {
  return {
    id: '',
    householdProfileId,
    name,
    panelId: 'oferta-panel',
    panelCount: Math.max(0, Math.round(form.panelCount)),
    batteryId: 'oferta-bateria',
    batteryCount: Math.max(0, Math.round(form.batteryCount)),
    inverterId: 'oferta-inversor',
    installationType: 'hybrid',
    params,
    origin: 'offer',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Comprobaciones técnicas de la oferta. Lo que no está declarado se lista como
 * «missing» y la verificación global queda en falso.
 */
export function checkOfferCompatibility(input: {
  household: HouseholdProfile;
  form: OfferEquipmentForm;
  panel: PanelSpec;
  battery: BatterySpec;
  inverter: InverterSpec;
}): OfferCompatibilityReport {
  const { household, form, panel, battery, inverter } = input;
  const missing: string[] = [];
  if (!(form.panelVocV > 0)) missing.push('Tensión Voc del panel');
  if (!(form.panelVmppV > 0)) missing.push('Tensión Vmp del panel');
  if (!(form.panelIscA > 0)) missing.push('Corriente Isc del panel');
  if (!(form.mpptMaxV > 0) || !(form.mpptMinV > 0)) missing.push('Límites de tensión del MPPT');
  if (!(form.batteryMaxDischargeW > 0)) missing.push('Potencia máxima de descarga de la batería');
  if (!(form.batteryMaxChargeW > 0)) missing.push('Potencia máxima de carga de la batería');
  if (!(form.panelNoct > 0)) missing.push('NOCT del panel');
  if (!(form.batteryV > 0)) missing.push('Tensión nominal del banco');

  const appliances = household.appliances.map((a) => ({ ...a, priority: effectivePriority(a, household.night) }));
  const demand = buildDailyDemand(appliances, systemParams());
  const continuousW = demand.reduce((sum, interval) => Math.max(sum, interval.totalW), 0);
  // El pico de diseño incluye el arranque más grande, igual que el
  // dimensionado: una oferta no debe aprobarse ignorando el pico.
  const peakW = peakDesignW(analyzeEnergy(appliances, systemParams()));

  const diagnostics: Diagnostic[] = [];
  const array = checkBalancedArrayConfiguration(panel, inverter, Math.max(0, Math.round(form.panelCount)), systemParams());
  if (array.status === 'insufficient') {
    diagnostics.push({
      level: 'warning',
      code: 'STRING_INSUFFICIENT',
      message: array.violations[0] ?? 'Faltan datos eléctricos del panel o del MPPT para verificar la conexión de los paneles.',
    });
  } else if (array.status === 'incompatible') {
    for (const violation of array.violations) {
      diagnostics.push({ level: 'error', code: 'STRING_INFEASIBLE', message: violation });
    }
  } else {
    diagnostics.push({
      level: 'info',
      code: 'STRING_OK',
      message: `SolarAPP encuentra ${array.totalStrings} strings de ${array.panelsPerString} panel(es), distribuidos de forma equilibrada: ${array.stringsPerMppt.join(' / ')} por MPPT.`,
    });
  }

  const inverterCheck = checkInverterCompatibility({
    inverter,
    battery,
    panel,
    panelCount: Math.max(0, Math.round(form.panelCount)),
    batteryCount: Math.max(1, Math.round(form.batteryCount)),
    continuousW,
    peakW,
    voltage: household.voltage,
    params: systemParams(),
  });
  diagnostics.push(...inverterCheck.diagnostics);

  if (missing.length) {
    diagnostics.push({
      level: 'warning',
      code: 'OFFER_MISSING_DATA',
      message: `La oferta no declara: ${missing.join(', ')}. La simulación usa hipótesis declaradas y esas comprobaciones quedan SIN VERIFICAR.`,
    });
  }

  return { verified: missing.length === 0, diagnostics, missing };
}