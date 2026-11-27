import type { DesignParams, InverterSpec, PanelSpec, SolarInputs } from '../core/types';

/** Irradiancia instantánea (W/m²) con forma senoidal y área igual a HSP. */
export function irradianceAt(hour: number, solar: SolarInputs): number {
  const dayLength = solar.sunset - solar.sunrise;
  if (dayLength <= 0 || solar.hsp <= 0 || hour < solar.sunrise || hour > solar.sunset) return 0;
  const peak = (solar.hsp * 1000 * Math.PI) / (2 * dayLength);
  return Math.max(0, peak * Math.sin((Math.PI * (hour - solar.sunrise)) / dayLength));
}

/** Temperatura estimada de célula y factor de potencia térmico. */
export function cellConditions(
  irradianceWm2: number,
  solar: SolarInputs,
): { cellC: number; derate: number } {
  const cellC = solar.ambientC + ((solar.noct - 20) / 800) * irradianceWm2;
  const raw = 1 + solar.tempCoeffPmpp * (cellC - 25);
  return { cellC, derate: Math.min(1.1, Math.max(0.6, raw)) };
}

/** Potencia DC generada por el array antes de los límites del inversor. */
export function pvDcPowerAt(
  hour: number,
  installedW: number,
  solar: SolarInputs,
): number {
  const g = irradianceAt(hour, solar);
  if (g <= 0 || installedW <= 0) return 0;
  const { derate } = cellConditions(g, solar);
  return Math.max(
    0,
    installedW * (g / 1000) * derate * solar.tiltFactor * (1 - solar.shading),
  );
}

/**
 * Estado de la comprobación de strings:
 *  - `verified`     : hay datos suficientes y se cumplen todas las restricciones.
 *  - `incompatible` : hay datos suficientes y alguna restricción se incumple.
 *  - `insufficient` : faltan datos eléctricos: NO se puede verificar nada.
 */
export type StringStatus = 'verified' | 'incompatible' | 'insufficient';

export interface StringCheck {
  minSeries: number;
  maxSeries: number;
  recommendedSeries: number;
  maxParallelPerMppt: number;
  maxDcWattsPerMppt: number;
  vocColdV: number;
  vmpHotV: number;
  feasible: boolean;
  status: StringStatus;
  notes: string[];
  violations: string[];
}

/**
 * Valor estrictamente positivo y finito; cualquier otro caso es «dato ausente».
 */
function isPositiveFinite(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Preferencia de configuración por string: 3 módulos es un punto de partida
 * habitual que deja margen de tensión en frío. NO es un máximo: si la ventana
 * factible no lo admite se usa el valor factible más próximo, y si la ventana
 * está vacía no se recomienda nada.
 */
const PREFERRED_SERIES = 3;

function emptyResult(violations: string[], notes: string[], status: StringStatus): StringCheck {
  return {
    minSeries: 0,
    maxSeries: 0,
    recommendedSeries: 0,
    maxParallelPerMppt: 0,
    maxDcWattsPerMppt: 0,
    vocColdV: 0,
    vmpHotV: 0,
    feasible: false,
    status,
    notes,
    violations,
  };
}

/**
 * Comprueba la compatibilidad eléctrica panel–MPPT en el peor caso térmico.
 * No recomienda una configuración que exceda los límites del equipo.
 *
 * Nunca interpreta `Infinity` como «sin límite»: un límite no declarado deja
 * la comprobación en `insufficient`, no en `verified`.
 */
export function checkStringDesign(
  panel: PanelSpec,
  inverter: InverterSpec,
  params: DesignParams,
): StringCheck {
  const notes: string[] = [];
  const violations: string[] = [];

  const mppt = inverter.mppt?.[0];
  if (!mppt) {
    violations.push('El inversor no declara entradas MPPT. No se puede verificar el array.');
    return emptyResult(violations, notes, 'insufficient');
  }

  // --- Datos de panel necesarios: sin ellos no hay nada que verificar ---
  const missingPanel: string[] = [];
  if (!isPositiveFinite(panel.vocV)) missingPanel.push('Voc');
  if (!isPositiveFinite(panel.vmppV)) missingPanel.push('Vmpp');
  if (!isPositiveFinite(panel.iscA)) missingPanel.push('Isc');
  if (!isPositiveFinite(panel.imppA)) missingPanel.push('Imp');
  if (!isPositiveFinite(panel.powerW)) missingPanel.push('potencia nominal');
  if (missingPanel.length > 0) {
    violations.push(
      `Datos del panel insuficientes (faltan: ${missingPanel.join(', ')}). No se puede verificar la configuración de strings.`,
    );
    notes.push('Introduce los datos de la ficha técnica del panel para verificar tensión, corriente y número de módulos.');
    return emptyResult(violations, notes, 'insufficient');
  }

  // --- Límites del MPPT/inversor: deben estar declarados y ser finitos ---
  const missingMppt: string[] = [];
  if (!isPositiveFinite(mppt.maxVoltageV)) missingMppt.push('tensión máxima del MPPT');
  if (!isPositiveFinite(mppt.minVoltageV)) missingMppt.push('tensión mínima del MPPT');
  if (!isPositiveFinite(mppt.maxCurrentA)) missingMppt.push('corriente máxima del MPPT');
  if (!isPositiveFinite(mppt.maxPowerW)) missingMppt.push('potencia máxima del MPPT');
  if (!isPositiveFinite(inverter.maxPvVoltageV)) missingMppt.push('tensión absoluta de entrada del inversor');
  if (missingMppt.length > 0) {
    violations.push(
      `Límites de entrada no declarados (faltan: ${missingMppt.join(', ')}). No se puede verificar la configuración de strings.`,
    );
    notes.push('Sin esos límites no es posible comprobar si la serie de paneles entra en la ventana de tensión.');
    return emptyResult(violations, notes, 'insufficient');
  }

  const tempCoeffVoc = panel.tempCoeffVoc !== 0 ? panel.tempCoeffVoc : params.tempCoeffVoc;
  const tempCoeffPmpp = panel.tempCoeffPmpp !== 0 ? panel.tempCoeffPmpp : params.tempCoeffPmpp;
  const noct = panel.noct > 0 ? panel.noct : params.noct;
  const vocColdV = panel.vocV * (1 + tempCoeffVoc * (params.minAmbientC - 25));
  const cellHotC = params.ambientC + ((noct - 20) / 800) * 1000;
  const vmpHotV = panel.vmppV * (1 + tempCoeffPmpp * (cellHotC - 25));

  if (!Number.isFinite(vocColdV) || !Number.isFinite(vmpHotV) || vmpHotV <= 0) {
    violations.push('Los coeficientes térmicos del panel no producen una tensión válida.');
    return emptyResult(violations, notes, 'insufficient');
  }

  const maxSeries = Math.floor(
    Math.min(inverter.maxPvVoltageV, mppt.maxVoltageV) / Math.max(vocColdV, 1),
  );
  const minSeries = Math.ceil(mppt.minVoltageV / Math.max(vmpHotV, 1));

  // --- Ventana factible: si está vacía no se recomienda nada ---
  const windowFeasible = maxSeries >= 1 && minSeries <= maxSeries;
  const recommendedSeries = windowFeasible
    ? Math.min(Math.max(minSeries, PREFERRED_SERIES), maxSeries)
    : 0;

  const currentPerStringA = panel.iscA * 1.1;
  const maxParallelByCurrent = Math.floor(mppt.maxCurrentA / Math.max(currentPerStringA, 0.001));
  const maxParallelByPower =
    recommendedSeries > 0
      ? Math.floor(mppt.maxPowerW / Math.max(panel.powerW * recommendedSeries, 1))
      : 0;
  const maxParallelPerMppt = Math.max(0, Math.min(maxParallelByCurrent, maxParallelByPower));
  const maxDcWattsPerMppt = Math.min(mppt.maxPowerW, mppt.maxCurrentA * mppt.maxVoltageV);

  if (maxSeries <= 0) {
    violations.push(
      `Una sola placa supera la tensión máxima del MPPT en frío (${vocColdV.toFixed(1)} V).`,
    );
  } else if (minSeries > maxSeries) {
    violations.push(
      `No hay número de placas en serie que cumpla la ventana del MPPT (mín. ${minSeries}, máx. ${maxSeries}).`,
    );
  } else if (maxParallelPerMppt <= 0) {
    violations.push('La corriente o potencia del string supera el límite del MPPT.');
  }
  if (vocColdV > inverter.maxPvVoltageV) {
    violations.push('La tensión en circuito abierto en frío supera el límite absoluto del inversor.');
  }

  notes.push(`Voc estimada a ${params.minAmbientC} °C: ${vocColdV.toFixed(1)} V (hipótesis).`);
  notes.push(`Vmp estimada a ${cellHotC.toFixed(0)} °C de célula: ${vmpHotV.toFixed(1)} V.`);
  notes.push(
    windowFeasible
      ? `Ventana de serie: ${minSeries}–${maxSeries} placas por string; recomendada ${recommendedSeries}.`
      : `Ventana de serie vacía: se necesitarían ${minSeries} placas como mínimo y sólo caben ${maxSeries}.`,
  );

  const status: StringStatus = violations.length === 0 ? 'verified' : 'incompatible';
  return {
    minSeries,
    maxSeries,
    recommendedSeries,
    maxParallelPerMppt,
    maxDcWattsPerMppt,
    vocColdV,
    vmpHotV,
    feasible: violations.length === 0,
    status,
    notes,
    violations,
  };
}



/**
 * Potencia PV utilizable para dimensionamiento energético.
 *
 * - Si faltan datos eléctricos, utiliza el límite PV anunciado.
 * - Si todos los MPPT tienen ventanas de tensión explícitamente
 *   imposibles, devuelve cero.
 * - Cuando existen datos suficientes, comprueba configuraciones
 *   reales y respeta los límites de los strings.
 */
export function usablePvLimitW(
  inverter: InverterSpec,
  panel: PanelSpec,
  params: DesignParams,
): number {
  if (
    !isPositiveFinite(inverter.maxPvInputW) ||
    !isPositiveFinite(panel.powerW)
  ) {
    return 0;
  }

  const mppts = inverter.mppt ?? [];

  // Detectar MPPT cuya tensión mínima supera todos sus límites
  // superiores conocidos, incluida la tensión máxima del inversor.
  const everyMpptHasImpossibleVoltageWindow =
    mppts.length > 0 &&
    mppts.every((mppt) => {
      if (!isPositiveFinite(mppt.minVoltageV)) {
        return false;
      }

      const upperBounds = [
        mppt.maxVoltageV,
        inverter.maxPvVoltageV,
      ].filter(isPositiveFinite);

      if (upperBounds.length === 0) {
        return false;
      }

      return mppt.minVoltageV > Math.min(...upperBounds);
    });

  // Una contradicción eléctrica conocida nunca se sustituye
  // por una estimación basada en la potencia anunciada.
  if (everyMpptHasImpossibleVoltageWindow) {
    return 0;
  }

  // Un MPPT incompletamente documentado permite simulación
  // energética orientativa, pero no verificación de strings.
  const probe = checkBalancedArrayConfiguration(
    panel,
    inverter,
    1,
    params,
  );

  if (probe.status === 'insufficient') {
    return inverter.maxPvInputW;
  }

  const maxModulesByAdvertisedPower = Math.floor(
    inverter.maxPvInputW / panel.powerW,
  );

  let bestVerifiedW = 0;

  for (
    let count = 1;
    count <= maxModulesByAdvertisedPower;
    count += 1
  ) {
    const candidate = checkBalancedArrayConfiguration(
      panel,
      inverter,
      count,
      params,
    );

    if (candidate.status === 'verified') {
      bestVerifiedW = count * panel.powerW;
    }
  }

  return bestVerifiedW;
}



/**
 * Resultado de la búsqueda automática de una distribución de strings.
 * No solicita al cliente que diseñe el cableado: sólo comprueba si existe
 * una distribución uniforme de módulos en serie y equilibrada entre MPPT.
 */
export interface BalancedArrayConfigurationCheck {
  status: StringStatus;
  feasible: boolean;
  panelsPerString: number;
  totalStrings: number;
  /** Número de strings asignados a cada MPPT; 0 significa que no se utiliza. */
  stringsPerMppt: number[];
  notes: string[];
  violations: string[];
}

function emptyBalancedResult(
  status: StringStatus,
  violations: string[],
  notes: string[] = [],
): BalancedArrayConfigurationCheck {
  return { status, feasible: false, panelsPerString: 0, totalStrings: 0, stringsPerMppt: [], notes, violations };
}

function chooseIndices(values: number[], count: number): number[][] {
  const result: number[][] = [];
  const visit = (start: number, chosen: number[]) => {
    if (chosen.length === count) {
      result.push([...chosen]);
      return;
    }
    for (let index = start; index <= values.length - (count - chosen.length); index += 1) {
      chosen.push(values[index]);
      visit(index + 1, chosen);
      chosen.pop();
    }
  };
  visit(0, []);
  return result;
}

/**
 * Busca una configuración eléctricamente posible para el número total de
 * paneles. Todos los strings usan el mismo número de módulos en serie. Si hay
 * varios MPPT, reparte los strings entre ellos con diferencias máximas de uno.
 *
 * Los coeficientes térmicos/NOCT ausentes se sustituyen por las hipótesis de
 * diseño. Voc/Vmp y los límites eléctricos de al menos un MPPT no se inventan:
 * sin ellos el estado es `insufficient`, nunca `verified`.
 */
export function checkBalancedArrayConfiguration(
  panel: PanelSpec,
  inverter: InverterSpec,
  panelCount: number,
  params: DesignParams,
): BalancedArrayConfigurationCheck {
  const count = Math.max(0, Math.floor(panelCount));
  if (count < 1) return emptyBalancedResult('insufficient', ['Indica la cantidad de paneles para comprobar el campo fotovoltaico.']);
  if (!isPositiveFinite(panel.powerW)) {
    return emptyBalancedResult('insufficient', ['Falta la potencia nominal del panel.']);
  }
  if (!isPositiveFinite(inverter.maxPvInputW)) {
    return emptyBalancedResult('insufficient', ['Falta la potencia fotovoltaica máxima admitida por el inversor.']);
  }
  if (!isPositiveFinite(panel.vocV) || !isPositiveFinite(panel.vmppV)) {
    return emptyBalancedResult('insufficient', ['Faltan Voc o Vmp del panel. La producción puede simularse, pero no se puede verificar la conexión de strings.']);
  }

  const installedW = panel.powerW * count;
  if (installedW > inverter.maxPvInputW + 1e-6) {
    return emptyBalancedResult('incompatible', [
      `El campo suma ${Math.round(installedW)} W, por encima de los ${Math.round(inverter.maxPvInputW)} W de entrada PV admitidos por el inversor.`,
    ]);
  }

  const currentAtShortCircuit = isPositiveFinite(panel.iscA)
    ? panel.iscA
    : isPositiveFinite(panel.imppA)
      ? panel.imppA
      : 0;
  if (!isPositiveFinite(currentAtShortCircuit)) {
    return emptyBalancedResult('insufficient', ['Falta Isc o Imp del panel para comprobar la corriente de los strings.']);
  }

  const declaredMppts = inverter.mppt ?? [];
  const completeMppts = declaredMppts
    .map((mppt, index) => ({ mppt, index }))
    .filter(({ mppt }) =>
      isPositiveFinite(mppt.maxVoltageV) &&
      isPositiveFinite(mppt.minVoltageV) &&
      isPositiveFinite(mppt.maxCurrentA) &&
      isPositiveFinite(mppt.maxPowerW) &&
      mppt.minVoltageV <= mppt.maxVoltageV,
    );
  if (!isPositiveFinite(inverter.maxPvVoltageV) || completeMppts.length === 0) {
    return emptyBalancedResult('insufficient', [
      'Faltan límites de tensión, corriente o potencia de los MPPT. La simulación energética puede continuar, pero la conexión fotovoltaica debe comprobarla un instalador.',
    ]);
  }

  const tempCoeffVoc = panel.tempCoeffVoc !== 0 ? panel.tempCoeffVoc : params.tempCoeffVoc;
  const tempCoeffPmpp = panel.tempCoeffPmpp !== 0 ? panel.tempCoeffPmpp : params.tempCoeffPmpp;
  const noct = panel.noct > 0 ? panel.noct : params.noct;
  const vocColdV = panel.vocV * (1 + tempCoeffVoc * (params.minAmbientC - 25));
  const cellHotC = params.ambientC + ((noct - 20) / 800) * 1000;
  const vmpHotV = panel.vmppV * (1 + tempCoeffPmpp * (cellHotC - 25));
  if (!(vocColdV > 0) || !(vmpHotV > 0) || !Number.isFinite(vocColdV + vmpHotV)) {
    return emptyBalancedResult('insufficient', ['Los datos del panel y las hipótesis térmicas no permiten calcular tensiones válidas.']);
  }

  const currentDesignA = currentAtShortCircuit * 1.1;
  // Cada MPPT conserva su propia ventana. Un MPPT que no admite cierta serie
  // no debe invalidar otro MPPT que sí puede recibirla.
  const channels = completeMppts.map(({ mppt, index }) => ({
    index,
    minSeries: Math.ceil(mppt.minVoltageV / vmpHotV),
    maxSeries: Math.floor(Math.min(mppt.maxVoltageV, inverter.maxPvVoltageV) / vocColdV),
    maxParallelByCurrent: Math.floor(mppt.maxCurrentA / Math.max(currentDesignA, 0.001)),
    maxParallelByPower: (series: number) => Math.floor(mppt.maxPowerW / Math.max(series * panel.powerW, 1)),
  }));

  const lowestSeries = Math.max(1, Math.min(...channels.map((channel) => channel.minSeries)));
  const highestSeries = Math.max(...channels.map((channel) => channel.maxSeries));
  if (highestSeries < lowestSeries) {
    return emptyBalancedResult('incompatible', [
      'Ninguna de las entradas MPPT documentadas admite la tensión de un string formado por estos paneles, incluso usando una sola placa en serie.',
    ]);
  }

  const candidates: Array<{ series: number; strings: number; counts: number[]; used: number }> = [];
  for (let series = lowestSeries; series <= highestSeries; series += 1) {
    if (count % series !== 0) continue;
    const strings = count / series;
    const available = channels
      .map((channel, channelIndex) => ({
        channelIndex,
        capacity: Math.max(0, Math.min(channel.maxParallelByCurrent, channel.maxParallelByPower(series))),
      }))
      .filter(({ channelIndex, capacity }) =>
        capacity > 0 && series >= channels[channelIndex].minSeries && series <= channels[channelIndex].maxSeries,
      );
    if (available.length === 0) continue;

    const maxUsed = Math.min(strings, available.length);
    for (let used = maxUsed; used >= 1; used -= 1) {
      const subsets = chooseIndices(available.map((entry) => entry.channelIndex), used);
      let foundForSeries = false;
      for (const subset of subsets) {
        const baseStrings = Math.floor(strings / used);
        const extraStrings = strings % used;
        const ordered = [...subset].sort((a, b) => {
          const capA = available.find((entry) => entry.channelIndex === a)?.capacity ?? 0;
          const capB = available.find((entry) => entry.channelIndex === b)?.capacity ?? 0;
          return capB - capA;
        });
        const assigned = new Array<number>(inverter.mppt.length).fill(0);
        let valid = true;
        ordered.forEach((channelIndex, rank) => {
          const assignedStrings = baseStrings + (rank < extraStrings ? 1 : 0);
          const capacity = available.find((entry) => entry.channelIndex === channelIndex)?.capacity ?? 0;
          if (assignedStrings > capacity) valid = false;
          assigned[channels[channelIndex].index] = assignedStrings;
        });
        if (valid) {
          candidates.push({ series, strings, counts: assigned, used });
          foundForSeries = true;
          break;
        }
      }
      if (foundForSeries) break;
    }
  }

  if (!candidates.length) {
    if (completeMppts.length < declaredMppts.length) {
      return emptyBalancedResult('insufficient', [
        'Los límites de una o varias entradas MPPT están incompletos. Con las entradas documentadas no se encontró una distribución, pero no se puede descartar que las entradas sin datos admitan parte del campo fotovoltaico.',
      ]);
    }
    return emptyBalancedResult('incompatible', [
      `Con ${count} paneles no se encontró una distribución con el mismo número de módulos en cada string y un reparto equilibrado entre las entradas MPPT documentadas.`,
    ]);
  }

  candidates.sort((a, b) =>
    b.used - a.used || Math.abs(a.series - PREFERRED_SERIES) - Math.abs(b.series - PREFERRED_SERIES),
  );
  const best = candidates[0];
  const usedCounts = best.counts.filter((value) => value > 0);
  const balanced = usedCounts.length < 2 || Math.max(...usedCounts) - Math.min(...usedCounts) <= 1;
  const estimatedFields: string[] = [];
  if (panel.tempCoeffVoc === 0) estimatedFields.push('coeficiente térmico Voc');
  if (panel.tempCoeffPmpp === 0) estimatedFields.push('coeficiente térmico de potencia');
  if (panel.noct <= 0) estimatedFields.push('NOCT');
  if (panel.iscA <= 0) estimatedFields.push('Isc (estimada desde Imp)');

  const notes = [
    `Se encontró una distribución posible: ${best.series} paneles por string y ${best.strings} strings en total.`,
    `Strings distribuidos por MPPT: ${best.counts.map((value, index) => `MPPT ${index + 1}: ${value}`).join('; ')}.`,
    ...(balanced ? ['La cantidad de strings por MPPT utilizado difiere como máximo en uno.'] : []),
    ...(estimatedFields.length ? [`Se usaron hipótesis para: ${estimatedFields.join(', ')}.`] : []),
  ];
  return {
    status: 'verified',
    feasible: true,
    panelsPerString: best.series,
    totalStrings: best.strings,
    stringsPerMppt: best.counts,
    notes,
    violations: [],
  };
}
