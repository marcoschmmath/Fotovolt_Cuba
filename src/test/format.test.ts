import { describe, expect, it } from 'vitest';
import { parseDecimalInput } from '../ui/components';
import { formatHour } from '../ui/charts';

/** Formato de hora (antes un intervalo 23,999 h imprimía «23:60»). */
describe('formatHour', () => {
  it('formatea la hora normal', () => {
    expect(formatHour(13.5)).toBe('13:30');
    expect(formatHour(0)).toBe('00:00');
    expect(formatHour(7.25)).toBe('07:15');
  });

  it('no imprime minutos imposibles como 23:60', () => {
    expect(formatHour(23.999)).toBe('00:00');
    expect(formatHour(11.9999)).toBe('12:00');
  });

  it('normaliza horas fuera de rango', () => {
    expect(formatHour(24.5)).toBe('00:30');
  });
});

/** Campo numérico con coma decimal (M2) y coeficientes negativos (C8). */
describe('parseDecimalInput', () => {
  it('acepta coma decimal española y punto', () => {
    expect(parseDecimalInput('1,5')).toBe(1.5);
    expect(parseDecimalInput('1.5')).toBe(1.5);
    expect(parseDecimalInput(' 2,25 ')).toBe(2.25);
  });

  it('no convierte una entrada incompleta en cero', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('-')).toBeNull();
    expect(parseDecimalInput('1,')).toBe(1);
    expect(parseDecimalInput('.')).toBeNull();
  });

  it('respeta un mínimo negativo (coeficientes térmicos)', () => {
    expect(parseDecimalInput('-0,003', -0.01, 0)).toBe(-0.003);
    expect(parseDecimalInput('-0,5', -0.01, 0)).toBe(-0.01);
  });

  it('recorta al rango declarado', () => {
    expect(parseDecimalInput('30', 1, 24)).toBe(24);
    expect(parseDecimalInput('0,2', 0.4, 1)).toBe(0.4);
  });

  it('descarta texto no numérico', () => {
    expect(parseDecimalInput('abc')).toBeNull();
    expect(parseDecimalInput('12abc')).toBeNull();
  });
});