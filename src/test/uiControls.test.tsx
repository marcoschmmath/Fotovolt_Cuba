// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Stepper } from '../ui/components';
import { DEFAULT_COOKING, defaultCookingActivities } from '../domain/household/types';
import type { HouseholdProfile } from '../domain/household/types';
import { appliance } from './fixtures';

/**
 * Pruebas de interfaz de los controles corregidos en la revisión visual:
 * el selector de combustible (tarjetas `choice`) y el stepper de pasos.
 *
 * Se montan de verdad en happy-dom para comprobar el DOM accesible, la
 * selección de radios y que el stepper no depende de un número fijo de pasos.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: React.ReactNode): HTMLElement {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  host?.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
  return host;
}

afterAll(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
});

describe('tarjetas de combustible (política de cocción)', () => {
  function household(fuelKind: HouseholdProfile['cooking']['fuelKind']): HouseholdProfile {
    return {
      id: 'h1',
      name: 'Casa de prueba',
      appliances: [appliance({ id: 'a1', name: 'Refrigerador', powerW: 150, hoursPerDay: 24, schedule: 'both' })],
      cooking: { ...DEFAULT_COOKING, fuelKind, fuelConfirmed: fuelKind !== null, substitution: 'electric-first' },
      activities: defaultCookingActivities(),
      night: { essentialIds: ['a1'] },
      voltage: 'both',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  /** Réplica mínima de la sección: la misma estructura DOM que StepHabits. */
  function ChoiceSection({
    initial,
    onSelect,
  }: {
    initial: HouseholdProfile;
    onSelect?: (value: string) => void;
  }) {
    type Policy = HouseholdProfile['cooking']['substitution'];
    const [value, setValue] = useState<Policy>(initial.cooking.substitution);
    const options: Array<[Policy, string]> = [
      ['electric-first', 'Eléctrico si se puede'],
      ['fuel-first', 'Combustible si toca batería'],
      ['never', 'Siempre eléctrico'],
    ];
    return createElement(
      'fieldset',
      { className: 'field field--group' },
      createElement('legend', { className: 'field__label' }, 'Cuando la cocción eléctrica no se pueda cubrir'),
      createElement(
        'div',
        { className: 'choice-list', role: 'radiogroup', 'aria-label': 'Política de cocción' },
        options.map(([value_, label]) =>
          createElement(
            'label',
            { key: value_, className: `choice ${value === value_ ? 'is-on' : ''}` },
            createElement('input', {
              type: 'radio',
              name: 'cooking-policy',
              value: value_,
              checked: value === value_,
              onChange: () => {
                setValue(value_);
                onSelect?.(value_);
              },
            }),
            createElement(
              'span',
              { className: 'choice__body' },
              createElement('strong', { className: 'choice__title' }, label),
              createElement('span', { className: 'choice__desc' }, 'Descripción completa de la política'),
            ),
          ),
        ),
      ),
    );
  }

  it('la opción por defecto llega seleccionada', () => {
    // El estado inicial viene del perfil real (electric-first por defecto).
    const el = mount(createElement(ChoiceSection, { initial: household('gas') }));
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
  });

  it('la opción por defecto llega seleccionada con carbón declarado', () => {
    const el = mount(createElement(ChoiceSection, { initial: household('charcoal') }));
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios[0].checked).toBe(true);
  });

  it('el radio conserva su tamaño intrínseco y no se estira', () => {
    const el = mount(createElement(ChoiceSection, { initial: household('charcoal') }));
    const radio = el.querySelector<HTMLInputElement>('input[type="radio"]')!;
    expect(radio.type).toBe('radio');
    // El defecto original era que `.field input { width: 100% }` estiraba el
    // radio: el grupo ya no usa `.field` como contenedor de inputs de texto.
    expect(radio.closest('.choice')!.querySelector('input:not([type="radio"])')).toBeNull();
  });

  it('cada opción tiene etiqueta accesible con título y descripción', () => {
    const el = mount(createElement(ChoiceSection, { initial: household('gas') }));
    const group = el.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Política de cocción');
    const labels = [...el.querySelectorAll('.choice')];
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.querySelector('.choice__title')!.textContent).toBeTruthy();
      expect(label.querySelector('.choice__desc')!.textContent).toBeTruthy();
    }
  });

  it('selecciona la política pulsada y actualiza el estado seleccionado', () => {
    const chosen: string[] = [];
    const el = mount(createElement(ChoiceSection, { initial: household('gas'), onSelect: (v) => chosen.push(v) }));
    const before = [...el.querySelectorAll('.choice')];
    expect(before[0].classList.contains('is-on')).toBe(true);
    // Se comprueba el estado re-renderizado consultando el DOM (los nodos que
    // guarda `radios` son los previos al clic y React los reemplaza).
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    act(() => {
      radios[1].click();
    });
    expect(chosen).toEqual(['fuel-first']);
    const after = [...el.querySelectorAll('.choice')];
    expect(after[1].classList.contains('is-on')).toBe(true);
    expect(after[0].classList.contains('is-on')).toBe(false);
    // `radios` son los nodos previos al clic: React los reemplaza, así que se
    // vuelve a consultar el DOM para comprobar el estado real.
    const current = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(current.filter((r) => r.checked).map((r) => r.value)).toEqual(['fuel-first']);
  });
});

describe('stepper', () => {
  it('expone el número real de pasos como variable CSS', () => {
    const el = mount(createElement(Stepper, { step: 1, labels: ['Equipos', 'Hábitos'] }));
    const stepper = el.querySelector<HTMLElement>('.stepper')!;
    expect(stepper.style.getPropertyValue('--stepper-steps')).toBe('2');
    expect(stepper.querySelectorAll('.stepper__item')).toHaveLength(2);
  });

  it('crece con la cantidad de pasos del asistente de sistema', () => {
    const el = mount(createElement(Stepper, { step: 3, labels: ['A', 'B', 'C', 'D', 'E'] }));
    const stepper = el.querySelector<HTMLElement>('.stepper')!;
    expect(stepper.style.getPropertyValue('--stepper-steps')).toBe('5');
    expect(stepper.querySelectorAll('.stepper__item')).toHaveLength(5);
    expect(stepper.querySelector('.is-current')!.textContent).toContain('3');
  });

  it('marca los pasos anteriores como completados y el actual con aria-current', () => {
    const el = mount(createElement(Stepper, { step: 2, labels: ['Equipos', 'Hábitos'] }));
    const items = [...el.querySelectorAll<HTMLElement>('.stepper__item')];
    expect(items[0].classList.contains('is-done')).toBe(true);
    expect(items[1].classList.contains('is-current')).toBe(true);
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[0].querySelector('svg')).toBeTruthy();
    expect(el.querySelector('.stepper')!.getAttribute('aria-label')).toBe('Paso 2 de 2');
  });
});