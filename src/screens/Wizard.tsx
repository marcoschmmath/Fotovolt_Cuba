import { useRef, type TouchEvent } from 'react';
import { useApp } from '../app/AppContext';
import type { Calculation } from '../app/useCalculation';
import { uid } from '../domain/persistence/storage';
import { Stepper } from '../ui/components';
import { StepAppliances } from './wizard/StepAppliances';
import { StepUsage } from './wizard/StepUsage';
import { StepSystem } from './wizard/StepSystem';
import { StepCompare } from './wizard/StepCompare';

const LABELS = ['Equipos', 'Uso', 'Sistema', 'Comparar'];

export function Wizard({ calculation, navigate }: { calculation: Calculation; navigate: (path: string) => void }) {
  const { state, patch } = useApp();
  const step = Math.min(4, Math.max(1, state.wizardStep));
  const touch = useRef<{ x: number; y: number; skip: boolean } | null>(null);

  function go(next: number) {
    const clamped = Math.min(4, Math.max(1, next));
    patch({ wizardStep: clamped });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onTouchStart(event: TouchEvent) {
    const target = event.target as HTMLElement;
    const point = event.touches[0];
    touch.current = {
      x: point.clientX,
      y: point.clientY,
      skip: Boolean(target.closest('input, select, textarea, .cat-tabs, .swiper__track, [role="slider"]')),
    };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || start.skip) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      go(step + (dx < 0 ? 1 : -1));
    }
  }

  function finish() {
    const index = Math.max(0, calculation.options.findIndex((o) => o.id === state.selectedOptionId));
    const option = calculation.options[index];
    const result = calculation.optionResults[index];
    if (option) {
      patch({
        selectedOptionId: option.id,
        recent: [
          {
            id: uid('calc'),
            date: new Date().toISOString(),
            label: option.label,
            optionId: option.id,
            dailyKwh: calculation.sizing.energy.dailyKwh,
            panelCount: option.panelCount,
            batteryKwh: option.batteryKwh,
            inverterW: option.inverter?.ratedW ?? 0,
            coverage: result?.totals.coverage ?? 0,
          },
          ...state.recent,
        ].slice(0, 10),
      });
    }
    navigate('/resultado');
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <Stepper step={step} labels={LABELS} onStep={go} />
      <p className="step-hint">Desliza el dedo a los lados o toca un paso para navegar</p>
      {step === 1 && <StepAppliances calculation={calculation} onNext={() => go(2)} />}
      {step === 2 && <StepUsage calculation={calculation} onNext={() => go(3)} onBack={() => go(1)} />}
      {step === 3 && <StepSystem calculation={calculation} onNext={() => go(4)} onBack={() => go(2)} />}
      {step === 4 && <StepCompare calculation={calculation} onFinish={finish} onBack={() => go(3)} />}
    </div>
  );
}
