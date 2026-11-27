import { describe, expect, it } from 'vitest';
import { APPLIANCE_TEMPLATES, templateToAppliance } from './appliances';
import { effectivePowerW } from '../calculator/energy';
import { DEFAULT_PARAMS } from '../core/defaults';

/**
 * La potencia que se MUESTRA en la tarjeta y el editor tiene que ser la misma
 * que consume el motor: si no, la app promete 900 W y simula 1200 W
 * (estimación engañosa en los aires acondicionados).
 */
describe('plantillas de electrodomésticos', () => {
  it('ninguna plantilla muestra una potencia distinta de la que se simula', () => {
    for (const template of APPLIANCE_TEMPLATES) {
      const appliance = templateToAppliance(template, 'app');
      expect(effectivePowerW(appliance, DEFAULT_PARAMS)).toBeCloseTo(template.powerW, 6);
    }
  });

  it('la plantilla de split inverter declara su EER para poder estimarse', () => {
    const split = APPLIANCE_TEMPLATES.find((t) => t.name === 'Split inverter');
    expect(split?.eer).toBeGreaterThan(0);
    expect(split?.btuPerHour).toBeGreaterThan(0);
  });

  it('incluye una carga editable para teléfonos móviles', () => {
    const template = APPLIANCE_TEMPLATES.find((item) => item.name === 'Carga de teléfonos móviles');
    expect(template).toBeDefined();
    expect(template?.category).toBe('Comunicaciones');
    expect(template?.quantity).toBe(2);
    expect(template?.powerW).toBe(10);
    expect(template?.hoursPerDay).toBe(2);
    const phones = templateToAppliance(template!, 'phones');
    expect(phones.quantity).toBe(2);
    expect(phones.schedule).toBe('night');
  });

  it('crea identificadores únicos por equipo añadido', () => {
    const template = APPLIANCE_TEMPLATES[0];
    const first = templateToAppliance(template, 'app-1');
    const second = templateToAppliance(template, 'app-2');
    expect(first.id).toBe('app-1');
    expect(second.id).toBe('app-2');
    expect(first.name).toBe(template.name);
  });
});