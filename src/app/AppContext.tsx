import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppState, SimulationSnapshot } from '../domain/persistence/storage';
import { createInitialState, loadState, saveState, uid } from '../domain/persistence/storage';

interface AppContextValue {
  state: AppState;
  patch: (value: Partial<AppState> | ((current: AppState) => Partial<AppState>)) => void;
  /** Guarda una foto del resultado actual (nunca se recalcula sola). */
  saveSnapshot: (snapshot: Omit<SimulationSnapshot, 'id' | 'createdAt'>) => void;
  reset: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => loadState());

  // Persistencia con debounce: antes se serializaba TODO el estado en cada
  // tecla. 350 ms es imperceptible al escribir y evita escribir por pulsación.
  useEffect(() => {
    const timer = window.setTimeout(() => saveState(state), 350);
    return () => window.clearTimeout(timer);
  }, [state]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      patch: (next) =>
        setState((current) => {
          const change = typeof next === 'function' ? next(current) : next;
          return { ...current, ...change };
        }),
      saveSnapshot: (snapshot) =>
        setState((current) => ({
          ...current,
          simulations: [{ ...snapshot, id: uid('sim'), createdAt: new Date().toISOString() }, ...current.simulations].slice(0, 50),
        })),
      reset: () => {
        setState(createInitialState());
      },
    }),
    [state],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp debe usarse dentro de AppProvider');
  return value;
}