// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PARAMS } from '../../domain/core/defaults';
import { APPLIANCE_TEMPLATES } from '../../domain/catalog/appliances';
import type { Appliance } from '../../domain/core/types';
import { StepAppliances } from './StepAppliances';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(initial: Appliance[] = []): HTMLElement {
  if (root) {
    act(() => root!.unmount());
  }
  host?.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  function Harness() {
    const [appliances, setAppliances] = useState(initial);
    return createElement(StepAppliances, {
      appliances,
      params: DEFAULT_PARAMS,
      onChange: setAppliances,
      onNext: () => undefined,
    });
  }

  act(() => root!.render(createElement(Harness)));
  return host;
}

afterAll(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('selector de equipos de la vivienda', () => {
  it('muestra primero los nueve equipos habituales y deja el resto plegado', () => {
    const el = mount();
    expect(el.querySelectorAll('.app-tile')).toHaveLength(9);
    expect(el.textContent).toContain('Ver todos los equipos');
    expect(el.textContent).not.toContain('Frigorífico');
  });

  it('permite desplegar el catálogo completo sin perder la selección', () => {
    const el = mount();
    const tile = [...el.querySelectorAll<HTMLButtonElement>('.app-tile')]
      .find((button) => button.textContent?.includes('Nevera'))!;
    act(() => tile.click());
    const selectedTile = [...el.querySelectorAll<HTMLButtonElement>('.app-tile')]
      .find((button) => button.textContent?.includes('Nevera'))!;
    expect(selectedTile.getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).toContain('Tus equipos (1)');

    const more = [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Ver todos los equipos'))!;
    act(() => more.click());
    expect(el.querySelectorAll('.app-tile')).toHaveLength(APPLIANCE_TEMPLATES.length);
    const stillSelected = [...el.querySelectorAll<HTMLButtonElement>('.app-tile')]
      .find((button) => button.textContent?.includes('Nevera'))!;
    expect(stillSelected.getAttribute('aria-pressed')).toBe('true');
  });

  it('mantiene los equipos ya seleccionados aunque no pertenezcan al grupo inicial', () => {
    const el = mount([{
      id: 'extra-1',
      name: 'Frigorífico',
      category: 'Refrigeración',
      icon: 'fridge',
      quantity: 1,
      powerW: 200,
      hoursPerDay: 24,
      schedule: 'both',
      startHour: 8,
      priority: 'critical',
      surgeFactor: 3.5,
      dutyCycle: 0.4,
      profile: 'cyclic',
    }]);
    const tile = [...el.querySelectorAll<HTMLButtonElement>('.app-tile')]
      .find((button) => button.textContent?.includes('Frigorífico'))!;
    expect(tile).toBeTruthy();
    expect(tile.getAttribute('aria-pressed')).toBe('true');
  });
});
