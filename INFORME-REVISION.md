# Informe de revisión — Calculadora Solar Cuba (SolarAPP)

Fecha: 23/11/2026 · Revisión estática completa de `src/` (≈6.100 líneas), `public/` y configs.
Nota: no había Node/npm en la máquina de revisión, así que **no se ejecutaron** `npm test` ni `tsc`; todo lo siguiente proviene de lectura de código (los marcados ✔ fueron verificados personalmente contra el fichero).

---

## 1. Estado del proyecto

- **Versión 1 funcional**, PWA mobile-first lista para desplegar: `dist/` está **actualizado** respecto a `src/` (build 22/11 12:43, ningún fuente es más reciente).
- **44 pruebas** en 8 ficheros `*.test.ts` — coincide exactamente con lo que dice el README.
- **No hay repositorio git.** Es el riesgo estructural nº1: cualquier arreglo puede perderse sin posibilidad de revertir. *Acción inmediata: `git init` + commit antes de tocar nada.*
- Sin `TODO`/`FIXME`/`@ts-ignore`/`as any`/`console.log` en el código fuente: higiene básica buena.
- La app es **honesta por diseño** (hipótesis visibles, sin precios inventados, sin promesas de autonomía), y esa línea se respeta en el código.

## 2. Tecnologías

| Capa | Elección |
| --- | --- |
| Framework | React 18.3 + TypeScript 5.7 |
| Build | Vite 6 (`@vitejs/plugin-react`), `base: './'` (rutas relativas) |
| Tests | Vitest 2.1 (solo `src/**/*.test.ts`) |
| Estado | React Context + hooks propios (`AppContext`, `useCalculation`) |
| Gráficos | **Sin dependencias**: SVG propio en `src/ui/charts.tsx` |
| Estilos | CSS puro con tokens (`src/styles.css`), sin Tailwind/CSS-in-JS |
| PWA | Service worker propio (`public/sw.js`, versión `solar-cuba-v6`), manifest, fuentes autoalojadas (Instrument Serif + Space Grotesk) |
| Persistencia | `localStorage` versionado (`src/domain/persistence/storage.ts`) |
| Routing | Hash routing propio (`useHashRoute`) |
| Dependencias en runtime | **Solo `react` y `react-dom`** |

Arquitectura: `domain/` (módulos puros, sin imports de React, con tests) → `app/` (contexto y hooks) → `ui/` + `screens/`. La interfaz nunca calcula física: consume `useCalculation`. **Es una buena arquitectura y hay que preservarla.**

## 3. Lo que está bien (no tocar)

- Modelo de irradiancia `pv.ts`: `HSP·1000·π/(2·dayLength)` integra exactamente al HSP, testeado numéricamente.
- Ventana MPPT: `Voc` extrapolado en **frío** y `Vmp` en **calor** con NOCT — orden correcto de libro de texto, con tests en ambos sentidos.
- Orden de despacho por prioridad (crítica → importante → prescindible) y **presupuesto de red sí decrementado** correctamente entre prioridades.
- SOC acotado a `[minSoc, 1]` con clamp final a `[0, nominalKwh]`.
- `C_b = E_n·A/(DoD·η)` exacto y testeado con números a mano; guards por todas partes contra división por cero.
- `storage.ts`: el fichero mejor defendido (try/catch global, merge defensivo de catálogos, tolera cuota agotada/modo privado).
- Flags de honestidad (`isReference`, `sourceUrl`, notas) y descargo legal siempre presente.
- README: «44 pruebas» es correcto; la afirmación de que `domain/` no importa React se cumple.

---

## 4. BUGS ENCONTRADOS

### 🔴 CRÍTICOS — afectan a los cálculos (arreglar primero)

**C1. La batería puede descargar a 3× su potencia nominal por intervalo** ✔ verificado
`src/domain/simulator/engine.ts:100-115`
```ts
for (const priority of PRIORITIES) {
  const fromBattery = Math.min(need, maxDischargeW * dtKwh, ...);  // presupuesto fresco en cada vuelta
```
El presupuesto `maxDischargeW * dtKwh` **no se decrementa** entre las 3 prioridades, así que en un intervalo de 15 min se pueden extraer hasta 3× `maxDischargeW` (14,4 kW con un límite de 4,8 kW). El límite de **red** sí lo hace bien (`gridLimitKwh - gridUsedKwh`, línea 126), lo que demuestra la intención. La energía se conserva, por eso el test `valid` no lo detecta: inflige una cobertura falsa en apagones y dispararía un BMS real.
**Fix:** acumular `battUsedKwh` fuera del bucle y usar `maxDischargeW * dtKwh - battUsedKwh`. Añadir test con ≥2 prioridades simultáneas (el actual solo usa `priority: 'critical'`, nunca puede fallar).

**C2. La carga total puede ser 2× el límite del BMS; la ruta por red ignora `pack.maxChargeW`** ✔ verificado
`src/domain/simulator/engine.ts:139-161`
La carga **PV** (línea 142) y la carga **desde red** (línea 157) se aplican seguidas con límites independientes: nada acota su **suma** → hasta 2× `maxChargeW` y 2× `maxChargeA` en el mismo paso. Ocurre en el estado más común de la app (de día + red conectada + batería no llena). Además la ruta por red (150-154) **omite `pack.maxChargeW`**.
**Fix:** un único presupuesto de carga compartido por ambas fuentes; añadir `pack.maxChargeW * dtKwh` al `gridChargeLimit`.

**C3. DoD con dos fuentes de verdad → batería infradimensionada 15-25 %** ✔ verificado
`src/domain/calculator/battery.ts:39-46` (dimensiona con `params.dod`) vs `:21-24` (usa `battery.dod` + suelo `minSoc`).
Coinciden solo con los defaults (0,8/0,8/0,15). Si el usuario sube el DoD al 100 % (el slider lo permite, `StepSystem.tsx:149`) o elige una batería con `dod` menor que la hipótesis, el sistema dimensionado queda **15-25 % por debajo** de la carga nocturna. Sin ningún diagnóstico.
**Fix:** una sola definición (`usableFraction = 1 - max(params.minSoc, 1 - battery.dod)`) o rechazar con `Diagnostic`.

**C4. `dailyRechargeKwh` omite la eficiencia de descarga → array PV infradimensionado ~5 %** ✔ verificado
`src/domain/calculator/battery.ts:48-52`
```ts
return energy.nightKwh / eta;   // eta = chargeEff · inverterEfficiency
```
Lo que hay que **reponer** en la batería es `nightKwh / (η_dis · η_inv)`, no `nightKwh / (η_chg · η_inv)`. La propia cadena del motor (`engine.ts:116`) y `requiredBatteryNominalKwh` (línea 43) sí incluyen `η_dis`. Con los defaults: se pide 5,3 % menos energía PV de la que la física del simulador necesita → déficit diario de SOC. **No hay ningún test de `dailyRechargeKwh`** (los tests usan carga solo diurna, `nightKwh = 0`).

**C5. La autonomía se calcula de 3 formas distintas; con cero carga crítica da valores absurdos**
`src/domain/calculator/sizing.ts:205-209` (`Math.max(1, max(...critical)`) mata el guard `criticalAcW <= 0 → 0` de `battery.ts:65`) · `src/domain/simulator/offer.ts:146` (potencia **media** diaria) · `analysis.ts` (simulación).
Con carga crítica nula la app muestra «Autonomía estimada: 3496,0 h». Y «Autonomía orientativa» de la oferta puede exagerar hasta ×(`24/horas de uso`).
**Fix:** un único helper compartido; eliminar el `Math.max(1, …)`.

**C6. Paneles sin datos eléctricos → ventana `0–Infinity` y badge «Verificado» falso**
`src/domain/calculator/pv.ts:76-90`, `src/domain/simulator/offer.ts:62-76`, `src/screens/Catalog.tsx:98`.
Con `vocV = 0` (campo en blanco → `Number('') || 0`) e MPPT en `Infinity`: `maxSeries = floor(∞/1) = Infinity`, `feasible = true` → el diagnóstico dice literalmente «Ventana de serie: 0–Infinity placas por string» junto al badge verde **Verificado**.
**Fix:** `vocV/vmppV/iscA ≤ 0` o límites no finitos ⇒ `feasible: false` con violación `DATOS_INCOMPLETOS`.

**C7. Editar un inversor en el catálogo destruye datos** ✔ verificado
`src/screens/Catalog.tsx:71` (`i.mppt[0]` colapsa 2 MPPT a 1) y `:77` + `:117` (`acVoltages` con 110 **y** 220 vuelve a un solo valor). Como `save()` fuerza `inverterId = item.id` (línea 165), una edición de rutina puede volver **incompatible** el inversor activo con una vivienda de 110 V y romper el dimensionado. Pérdida silenciosa de datos.
**Fix:** conservar los arrays completos en el draft; multiselección para `acVoltages`.

**C8. Imposible escribir coeficientes de temperatura negativos** ✔ verificado
`src/ui/components.tsx:119` (`NumberField` con `min = 0` por defecto) + `:148-151` (recorta con `Math.max(min, parsed)` en cada tecleo) + `src/screens/Catalog.tsx:22` («normalmente negativo») y `Catalog.tsx:113` (`num(...) || -0.003`).
Teclear `-0,003` queda en `0`; luego `fromDraft` lo sustituye por el valor hardcodeado. **El usuario cree que introdujo el de su ficha técnica y no es así.**
**Fix:** `min: -0.1` explícito en `tempCoeffVoc`/`tempCoeffPmpp`.

### 🟠 MEDIOS — afectan a UX, datos guardados o accesibilidad

| # | Fichero:línea | Problema | Fix |
| --- | --- | --- | --- |
| M1 | `storage.ts:86-129` | Un solo elemento corrupto (`[null]` en `profiles`) lanza excepción → el `catch` global **borra todo el estado guardado** en silencio. `params` sin validar: `stepMinutes = 0` → `intervalCount = Infinity` → `RangeError`. Sin migración de versión. | Validación por campo con fallback individual; clamp de `stepMinutes` a `[5,10,15,30,60]`; `migrate()` explícito. |
| M2 | `components.tsx:140-151` | `type="number"` + teclado español: la coma `1,5` se lee como `''` → `Number('')===0` → el campo **salta a `min`** mientras se teclea (afecta a horas, DoD, sombras). | `type="text"` + `inputMode="decimal"` con buffer local, o tratar `''` como «sin cambio». |
| M3 | `Result.tsx:83` + `styles.css:201,76` | Subtítulo en lima `#C9F169` sobre papel `#F7F6F0` ≈ **1,2:1 de contraste** (ilegible). Resto de la revisión 1: `.app--dark` es idéntico a la regla base. | Usar el color por defecto del eyebrow (`#23766c`) o dar fondo oscuro al hero. |
| M4 | `charts.tsx:125-153` | `toHome = servedW - gridW - battDischarge` puede ser **negativo** (porque `gridW` incluye la carga desde red) → `strokeWidth` negativo, CSS inválido y flujo mal representado. | `Math.max(0, …)` en el cálculo y en `thickness()`. |
| M5 | `public/sw.js:58-84` | Cachea respuestas de navegación **sin comprobar `response.ok`** (un 500 sustituye `index.html` en la caché) y `cache.put` sin `.catch` → rechazos no manejados. | `if (response.ok)` + `.catch(() => {})`. |
| M6 | `OfferCheck.tsx:27-130` | El informe de oferta **nunca se invalida**: cambiar el formulario o los equipos muestra números viejos sin aviso. | `useMemo` sobre `[form, appliances, params, gridInput]` o limpiar en efecto. |
| M7 | `Catalog.tsx:163-176` | Editar un equipo **no seleccionado** cambia la selección activa; borrar fuerza la selección a `next[0]`. | Solo tocar `panelId`/`batteryId`/`inverterId` si el ítem afectado era el seleccionado. |
| M8 | `Catalog.tsx:84-119` | Sin validación numérica: panel con `powerW = 0` se guarda y se auto-selecciona → `Math.max(1, 0)` en `sizing.ts:86` produce **miles de paneles** en la tarjeta. | Validar `powerW/nominalKwh/ratedW > 0`, `dod ∈ (0,1]`; deshabilitar Guardar. |
| M9 | `battery.ts` vs `offer.ts`/`analysis.ts` | Ver C5: tres definiciones de autonomía. | Helper único. |
| M10 | `engine.ts:156-159` | La carga **desde red** no aplica `inverter.efficiency` (la PV sí): la energía de red se acredita ~8 % más alta y `totals.gridKwh` infradice. | Aplicar `η_inv` de forma simétrica. |
| M11 | `engine.ts:82` vs `battery.ts:43` | Dos fuentes de verdad de eficiencia de inversor (`inverter.efficiency` del catálogo vs `params.inverterEfficiency` = 0,92; el Deye declara 0,976). | Derivar un único valor. |
| M12 | `types.ts:196-200` | `servedByPriority`/`unservedByPriority` están en **kWh** pero todos los campos vecinos están en **W**, sin sufijo ni doc. `analysis.ts:21` usa `> 0.01` → una carga crítica de 15 W caída todo el intervalo (0,00375 kWh) **no se cuenta** como fallo. | Renombrar a `…Kwh` + test de unidades. |
| M13 | `analysis.ts:15-41` | `estimateRechargeHours` usa índice **global** en una simulación de 3 días → «recarga completa» de 28 h para algo que se llenó el día 2 a las 04:00; además cuenta las horas de oscuridad como carga. `testedAutonomyHours` salta intervalos sin carga crítica (el tiempo sigue pasando y la batería sigue gastándose). | Medir tiempo transcurrido real / solo intervalos con SOC creciente; declarar truncado. |
| M14 | `useCalculation.ts:37-52` vs `Result.tsx:151`, `StepCompare.tsx:100` | El tiempo de recarga mostrado junto a la opción **seleccionada** siempre viene de la opción «Equilibrada». | Calcular `recharge` por opción. |
| M15 | `pv.ts:84,88,135` | `recommendedSeries = Math.max(minSeries, Math.min(maxSeries, 3))` devuelve una serie **imposible** cuando `minSeries > maxSeries`; el `3` es un mágico que limita el PV utilizable a 4.400 W de 8.000 W declarados → `PV_LIMITED` injustificado. | `Math.min(Math.max(minSeries, 3), maxSeries)` y `usablePvLimitW = 0` si `!feasible`. |
| M16 | `grid.ts:23-42` | Con `stepMinutes` que no divide 60, `total` y `start` son fraccionarios: `available[19.5] = true` crea una **propiedad nombrada**, no un elemento del array → esa hora nunca se lee y el apagón sale mal en silencio. | `Math.round()` en `total` y `start`; `Number.isInteger`. |
| M17 | `sizing.ts:86,110-169` | Sin electrodomésticos → `desiredPanels = 0` → todos los inversores se descartan → el usuario ve «Ningún inversor del catálogo cumple…» **además** de `NO_LOADS`, y `config = null`. | Early return si `energy.dailyKwh <= 0`. |
| M18 | `sizing.ts:304-353` | `batteryCount` significa «1 pack» en `config` y «módulos reales» en la opción devuelta (error ×N si se mezclan); `isReference: true` en la batería sintética hace emitir el aviso «plantillas genéricas» a **todas** las opciones. | Renombrar/etiquetar y usar un flag distinto. |
| M19 | `Wizard.tsx:41-74` | La validación de pasos es cosmética: el swipe o tocar el stepper salta a cualquier paso pese al «Continuar» deshabilitado. | Gate en `go()`. |
| M20 | `components.tsx:328-332` | El índice del paginador asume página = viewport completo, pero las páginas son `min(86%, 22rem)` → en pantallas ≥700px el indicador **vuelve siempre a la página 0**. | Derivar de los offsets de los hijos o `IntersectionObserver`. |
| M21 | `Result.tsx:91-95`, `App.tsx:60-68` | Pestañas sin `tabpanel`/`aria-controls`/roving tabindex; ningún foco al cambiar de ruta; el scroll vuelve arriba también al usar «atrás». | ARIA completo + foco en `<main>`. |
| M22 | `StepSystem.tsx:14-15` | `id="select-Panel fotovoltaico"` — **espacios en un id HTML**, asociación label/for poco fiable. | Slugify. |
| M23 | `styles.css:88-89` | `color-mix()` sin fallback en la barra superior (Chrome 111+/Safari 16.2+); sin `-webkit-backdrop-filter`. En los móviles Android antiguos que apunta esta PWA el header queda **transparente**. | `background: var(--paper);` antes + prefijo webkit. |
| M24 | `styles.css` + `App.tsx:21`, `Wizard.tsx:21` | `prefers-reduced-motion` no cubre todas las transiciones ni los `scrollTo({behavior:'smooth'})`, pese a lo que promete `DESIGN.md:67`. | Gate en el media query y en JS con `matchMedia`. |
| M25 | `StepCompare.tsx:42-72` | `<button>` envolviendo `<h3>`, `<p>`, `<div>`: contenido **no permitido** por el modelo de contenido de `button`; los lectores aplanan la estructura de encabezados. | Reestructurar tarjeta + botón superpuesto. |

### 🟡 BAJOS (limpieza, deuda técnica)

- **Código muerto:** `selectInverter` (`inverter.ts:120`), `pvEnergyPotentialKwh` (`pv.ts:139`, además mal nombre: devuelve HSP, no kWh), `appliancePowerInput` (`energy.ts:250`), `IconButton`/`EmptyState` (`components.tsx`), `clearState` (`storage.ts:140`), prop `light` de `SectionTitle`, CSS `.toast`, `.visually-hidden`, `.play-btn`, `.lock-notice`, `.option-card__grid`; `.app--dark`/`.topbar--dark`/`.divider--light` son reglas **sin efecto** (el flag `dark` de `App.tsx:40-44` no hace nada).
- **Parámetros fantasma:** `DesignParams.gridMaxPowerW/gridChargePowerW/allowExport` **nunca se usan** (los reales son `GridModel.*`); coinciden por casualidad. `solarFromParams` hardcodea `sunrise: 6, sunset: 18` mientras la franja nocturna por defecto es 19→7. Contradice el README («todos los parámetros … editables desde el paso 3»: solo ~8 de ~25 lo son).
- **Plantilla de aire acondicionado:** `appliances.ts:37` declara `powerW: 900` pero `btuPerHour: 12000` + `powerIsEstimate` hace que el motor use **1200 W** (EER 10). El editor enseña 900 W.
- **`scenarios.ts`:** comentario dice «última franja» pero `findIndex` da la **primera**; el escenario «habitual» devuelve `base` **por referencia**; cadenas «Red: +1 h / −1 h» hardcodeadas aunque el ajuste no cambie nada.
- **`engine.ts`:** `unservedEvents` cruza la medianoche (0,0 − 23,75 < 0,5 → fusiona eventos de días distintos); `inverterLossW` cuenta el recorte AC como pérdida del inversor (doble conteo con `pvClippedW`); `new Array(n).fill(obj)` comparte un objeto; `formatHour` puede imprimir `23:60`.
- **`fixtures.ts:40`:** `inverter()` extiende `REFERENCE_INVERTERS[0]` → **comparte el array `mppt`** con los defaults del módulo; un test que lo mute corrompe el resto.
- **`offer.ts`:** `capacityAh` ignora `batteryVoltageV`; `maxChargeW = kWh·1000` (asume 1 C) sin declararlo en `missingData`; umbrales `>= 0.95` / `< 0.01` incoherentes con `> 0.01` del motor.
- **`StepUsage.tsx:61`:** tocar el chip «Otra cantidad» ya activo **resetea** el valor personalizado (7 h → 5 h).
- **`StepAppliances.tsx:173`:** `setExpanded(created.id)` se ejecuta también al *alternar* el equipo (borrar), dejando un id inexistente.
- **`Contact.tsx:28-41`:** `save()` vuelve en silencio con PIN vacío o logo >400 kB; sin feedback.
- **`Catalog.tsx:85,218`:** precio vacío se muestra como **0** (badge «USD 0»).
- **`Result.tsx`:** la animación del flujo sigue corriendo con la pestaña «flujo» fuera; `quote` queda obsoleto al cambiar de opción; `clipboard.writeText` sin `.catch` (la clase `.toast` existe y no se usa).
- **`App.tsx:72`:** `aria-current="page"` marca «Calcular» estando en `/oferta`.
- **`index.html:6`:** `<meta name="text-scale">` no es una meta real.
- **`main.tsx:17`:** `register('./sw.js')` se resuelve contra la URL del documento (mal scope si se sirve en `/subdir`).
- **`AppContext.tsx:16-18`:** se serializa **todo** el estado en cada tecleo → debounce ~300 ms.
- **`vitest.config.ts`:** `include: ['src/**/*.test.ts']` ignoraría silenciosamente cualquier futuro `*.test.tsx`.
- **DESIGN.md desfasado:** `--lime-ink` es `#5d8515` en CSS y `#6F941F` en el doc; `--lime-ink` sobre papel mide ~4,0:1, no los 4,6:1 prometidos; `.flow-node__sub` a 4,08:1 falla AA.

### 🧪 Calidad de las pruebas (hay tests que no prueban lo que dicen)

1. `engine.test.ts:54-72` — «el inversor limita la generación y la batería limita la descarga»: la fixture solo tiene prioridad `critical`, así que **nunca puede fallar** por el bug C1.
2. `engine.test.ts:7-11` — «conserva el balance energético»: el balance es algebraicamente idéntico a ambos lados (por construcción), `valid === true` **casi nunca puede ser falso**.
3. `engine.test.ts:104-107` — el nombre promete «no excede límites del inversor» pero solo asserta `0 ≤ soc ≤ 1` (garantizado por el clamp).
4. `engine.test.ts:99-102` — menciona `STUDY_REQUIRED`, que `simulate()` **nunca emite**.
5. `offer.test.ts:27` — `missingData.every(d => !d.includes('Voc'))` es **vacío**: `Voc` nunca se añade, pasa siempre.
6. `sizing.test.ts:25-29` — el test de `P_FV` usa carga solo diurna → `dailyRechargeKwh` (bug C4) se multiplica por 0 y **no se verifica nunca**.
7. Sin cobertura de: presupuesto de descarga multi-prioridad (C1), carga simultánea PV+red (C2), desajuste de DoD (C3), `dailyRechargeKwh` (C4), `grid.ts` con pasos no divisores, `storage.ts` carga/migración, `scenarios.adjustGridHours`.

---

## 5. Orden de arreglo propuesto

1. **Antes de nada:** `git init` + commit del estado actual (no hay control de versiones) e instalar Node 20+ para poder ejecutar `npm test` y `tsc -b` en cada cambio.
2. **Lote 1 — física (C1, C2)** con tests nuevos de ≥2 prioridades y de carga PV+red simultánea.
3. **Lote 2 — dimensionado (C3, C4)** + test de `dailyRechargeKwh` con carga **nocturna**.
4. **Lote 3 — coherencia (C5, C6, M13, M14):** una sola definición de autonomía, datos insuficientes ⇒ no verificado.
5. **Lote 4 — datos de usuario (M1 storage, C7, C8, M7, M8, M2):** proteger lo que el usuario guarda y escribe.
6. **Lote 5 — UX/PWA/accesibilidad (M3-M6, M19-M25).**
7. **Lote 6 — limpieza:** código muerto, parámetros fantasma, DESIGN.md, tests tautológicos, README («todos los parámetros editables» no es cierto).

**Criterio de éxito:** `npm test` en verde con los tests nuevos, `tsc -b` sin errores, y que los tests de C1/C2 fallen si se revierte el arreglo.
