import type { Appliance } from '../core/types';

export interface ApplianceTemplate {
  name: string;
  icon: string;
  category: string;
  powerW: number;
  hoursPerDay: number;
  schedule: Appliance['schedule'];
  priority: Appliance['priority'];
  surgeFactor: number;
  dutyCycle: number;
  profile: Appliance['profile'];
  quantity?: number;
  btuPerHour?: number;
  note?: string;
}

export const CATEGORIES = [
  'Refrigeración',
  'Climatización',
  'Entretenimiento',
  'Iluminación',
  'Cocina',
  'Otros',
];

/**
 * Potencias típicas orientativas de electrodomésticos. Se muestran como
 * valores iniciales editables: la potencia real es la de la placa del equipo.
 */
export const APPLIANCE_TEMPLATES: ApplianceTemplate[] = [
  { name: 'Nevera', icon: 'fridge', category: 'Refrigeración', powerW: 150, hoursPerDay: 24, schedule: 'both', priority: 'critical', surgeFactor: 3, dutyCycle: 0.35, profile: 'cyclic' },
  { name: 'Frigorífico', icon: 'fridge', category: 'Refrigeración', powerW: 200, hoursPerDay: 24, schedule: 'both', priority: 'critical', surgeFactor: 3.5, dutyCycle: 0.4, profile: 'cyclic' },
  { name: 'Congelador', icon: 'fridge', category: 'Refrigeración', powerW: 180, hoursPerDay: 24, schedule: 'both', priority: 'critical', surgeFactor: 3.5, dutyCycle: 0.45, profile: 'cyclic' },
  { name: 'Aire acondicionado convencional', icon: 'ac', category: 'Climatización', powerW: 1200, hoursPerDay: 6, schedule: 'day', priority: 'important', surgeFactor: 4.5, dutyCycle: 0.85, profile: 'modulated', btuPerHour: 12000, note: 'Potencia estimada desde BTU/h. Corrígela con la placa si la conoces.' },
  { name: 'Split inverter', icon: 'ac', category: 'Climatización', powerW: 900, hoursPerDay: 6, schedule: 'day', priority: 'important', surgeFactor: 2.5, dutyCycle: 0.7, profile: 'modulated', btuPerHour: 12000, note: 'Potencia estimada desde BTU/h. Corrígela con la placa si la conoces.' },
  { name: 'Televisión', icon: 'tv', category: 'Entretenimiento', powerW: 120, hoursPerDay: 4, schedule: 'night', priority: 'discretionary', surgeFactor: 1, dutyCycle: 1, profile: 'constant' },
  { name: 'Ordenador', icon: 'catalog', category: 'Entretenimiento', powerW: 100, hoursPerDay: 4, schedule: 'day', priority: 'important', surgeFactor: 1, dutyCycle: 1, profile: 'constant' },
  { name: 'Router', icon: 'router', category: 'Entretenimiento', powerW: 15, hoursPerDay: 24, schedule: 'both', priority: 'critical', surgeFactor: 1, dutyCycle: 1, profile: 'constant' },
  { name: 'Bombillas LED', icon: 'bulb', category: 'Iluminación', powerW: 10, hoursPerDay: 5, schedule: 'night', priority: 'important', surgeFactor: 1, dutyCycle: 1, profile: 'constant', quantity: 4 },
  { name: 'Microondas', icon: 'microwave', category: 'Cocina', powerW: 900, hoursPerDay: 0.5, schedule: 'day', priority: 'discretionary', surgeFactor: 1, dutyCycle: 1, profile: 'constant' },
  { name: 'Cocina eléctrica', icon: 'stove', category: 'Cocina', powerW: 2000, hoursPerDay: 1, schedule: 'day', priority: 'discretionary', surgeFactor: 1, dutyCycle: 1, profile: 'constant' },
  { name: 'Arrocera', icon: 'rice', category: 'Cocina', powerW: 500, hoursPerDay: 0.7, schedule: 'day', priority: 'important', surgeFactor: 1, dutyCycle: 1, profile: 'constant' },
  { name: 'Bomba de agua', icon: 'pump', category: 'Otros', powerW: 750, hoursPerDay: 1, schedule: 'day', priority: 'important', surgeFactor: 4, dutyCycle: 0.5, profile: 'cyclic' },
  { name: 'Ventilador', icon: 'fan', category: 'Otros', powerW: 60, hoursPerDay: 8, schedule: 'night', priority: 'important', surgeFactor: 1.2, dutyCycle: 1, profile: 'constant' },
  { name: 'Lavadora', icon: 'washer', category: 'Otros', powerW: 500, hoursPerDay: 1, schedule: 'day', priority: 'discretionary', surgeFactor: 3, dutyCycle: 0.6, profile: 'cyclic' },
];

export function templateToAppliance(template: ApplianceTemplate, uid: string): Appliance {
  return {
    id: uid,
    name: template.name,
    category: template.category,
    icon: template.icon,
    quantity: template.quantity ?? 1,
    powerW: template.powerW,
    hoursPerDay: template.hoursPerDay,
    schedule: template.schedule,
    startHour: 8,
    priority: template.priority,
    surgeFactor: template.surgeFactor,
    dutyCycle: template.dutyCycle,
    profile: template.profile,
    btuPerHour: template.btuPerHour,
    powerIsEstimate: Boolean(template.btuPerHour),
    note: template.note,
  };
}

export type { Appliance };
