/**
 * Configuración comercial centralizada.
 * Sustituye estos valores por los reales antes de publicar la aplicación.
 * El PIN es sólo una protección local cómoda, NO un mecanismo de seguridad.
 */
export interface CommercialConfig {
  businessName: string;
  installerName: string;
  phone: string;
  whatsapp: string;
  services: string;
  zones: string;
  logoDataUrl: string;
  pin: string;
}

export const DEFAULT_COMMERCIAL: CommercialConfig = {
  businessName: 'Tu instalador solar',
  installerName: 'Nombre del instalador',
  phone: '+53XXXXXXXX',
  whatsapp: '53XXXXXXXX',
  services:
    'Montaje de instalaciones fotovoltaicas: coloco los paneles, baterías e inversores que tú compras y reviso que la combinación sea compatible.',
  zones: 'Zonas de trabajo (configurables)',
  logoDataUrl: '',
  pin: '1234',
};

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function phoneConfigured(value: string): boolean {
  const digits = digitsOnly(value);
  return digits.length >= 8 && !/X/i.test(value);
}

export function telHref(value: string): string {
  return `tel:+${digitsOnly(value)}`;
}

export function whatsappHref(value: string, message?: string): string {
  const base = `https://wa.me/${digitsOnly(value)}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export function buildQuoteMessage(params: {
  dailyKwh: number;
  peakW: number;
  autonomyH: number;
  panels: number;
  panelW: number;
  batteryKwh: number;
  inverterW: number;
  option: string;
  coverage: number;
}): string {
  return [
    'Hola, quisiera una propuesta para mi instalación solar.',
    '',
    `Consumo diario estimado: ${params.dailyKwh.toFixed(2)} kWh`,
    `Potencia simultánea estimada: ${Math.round(params.peakW)} W`,
    `Autonomía deseada: ${params.autonomyH.toFixed(1)} h`,
    `Configuración: ${params.option}`,
    `Paneles: ${params.panels} × ${params.panelW} W (${(params.panels * params.panelW / 1000).toFixed(2)} kWp)`,
    `Batería: ${params.batteryKwh.toFixed(1)} kWh`,
    `Inversor: ${(params.inverterW / 1000).toFixed(1)} kW`,
    `Cobertura estimada en la simulación: ${(params.coverage * 100).toFixed(0)} %`,
    '',
    'Entiendo que es una estimación preliminar y que hace falta un estudio técnico presencial.',
  ].join('\n');
}
