import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppState } from '../domain/persistence/storage';
import { createInitialState, loadState, saveState } from '../domain/persistence/storage';

interface AppContextValue {
  state: AppState;
  patch: (value: Partial<AppState> | ((current: AppState) => Partial<AppState>)) => void;
  reset: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => loadState());

  useEffect(() => {
    saveState(state);
  }, [state]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      patch: (next) =>
        setState((current) => {
          const change = typeof next === 'function' ? next(current) : next;
          const mirrorAppliances =
            change.appliances !== undefined && change.profiles === undefined && change.activeProfileId === undefined;
          const profiles = mirrorAppliances
            ? current.profiles.map((profile) =>
                profile.id === current.activeProfileId ? { ...profile, appliances: change.appliances! } : profile,
              )
            : (change.profiles ?? current.profiles);
          return { ...current, ...change, profiles, version: 1 };
        }),
      reset: () => setState(createInitialState()),
    }),
    [state],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp debe usarse dentro de AppProvider');
  return context;
}
