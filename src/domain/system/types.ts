/**
 * Entidades de la instalación fotovoltaica propuesta. No contienen consumo:
 * apuntan a un HouseholdProfile que ya existe.
 */

import type { DesignParams } from '../core/types';
import { DEFAULT_PARAMS } from '../core/defaults';
import type { RecommendationTierId } from '../household/recommendationProfile';

export interface SystemConfiguration {
  id: string;
  /** Hogar al que pertenece esta instalación. */
  householdProfileId: string;
  name: string;
  panelId: string;
  panelCount: number;
  batteryId: string;
  batteryCount: number;
  inverterId: string;
  installationType: 'hybrid' | 'offgrid';
  /** Hipótesis de cálculo propias de la instalación (sol, eficiencias, DoD…). */
  params: DesignParams;
  /** Capa de consumo para las propuestas autogeneradas; ausente en diseños manuales. */
  recommendationTier?: RecommendationTierId;
  /** Origen del dato: diseñado en la app o introducido desde una oferta. */
  origin: 'user' | 'offer';
  createdAt: string;
  updatedAt: string;
}

export function systemParams(): DesignParams {
  // Copia: dos instalaciones no comparten el objeto de parámetros.
  return { ...DEFAULT_PARAMS };
}

export function installedPowerW(panelPowerW: number, panelCount: number): number {
  return Math.max(0, panelCount) * Math.max(0, panelPowerW);
}
