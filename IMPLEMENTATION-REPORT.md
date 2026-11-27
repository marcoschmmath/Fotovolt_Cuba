# IMPLEMENTATION-REPORT — SolarAPP (revisión de arquitectura de producto)

Fecha: 25/11/2026 · Revisor/orquestador: agente principal (Build)
Ronda adicional: **revisión visual y de interfaz** (radios del combustible,
stepper, inicio, desbordamiento, tablas anchas).
stepper, inicio, desbordamiento, tablas anchas).
Rama: `master` · HEAD: `074b2f5` (ronda anterior, sin commits nuevos: **ninguno autorizado**)

---

## 1. Línea base y resultado final

| Comprobación | Antes de esta revisión | Después |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 107 instalaciones, sin cambios | 107 instalaciones, sin cambios |
| `bun run test` | 60 pruebas / 9 ficheros | **148 pruebas / 17 ficheros, todas en verde** |
| `bunx tsc -b` | exit 0 | exit 0 |
| `bun run build` | 283,90 kB JS | 295,05 kB JS / 37,33 kB CSS (gzip 92,16 / 8,32 kB) |

Lockfiles: `bun.lock` intacto, `package-lock.json` original intacto, **ningún
lockfile nuevo**, cero comandos npm/pnpm/Yarn.

## 2. Orquestación

- **Subagentes:** SÍ disponibles en esta sesión. Se lanzó un subagente `explore`
  (solo lectura) para la auditoría independiente final. El resto del trabajo lo
  ejecutó el orquestador de forma secuencial, porque la implementación
  (dominario + pantallas) requiere decisiones de contrato encadenadas y repartirla
  habría roto la propiedad exclusiva de ficheros.
- **Skills cargadas y aplicadas:** `impeccable` (init → `PRODUCT.md`, flujo
  `document` → `DESIGN.md`, sin servicio externo ni login: la launcher local
  funciona), `frontend-design`, `frontend-ui-engineering`,
  `modern-web-guidance`, `web-design-guidelines`, `test-driven-development`,
  `code-review-and-quality`.
- **Impeccable init:** completado en el chat con el contexto del encargo →
  `PRODUCT.md` (verdad de producto, sin decisiones visuales).
- **Live mode:** no usado (requiere Chrome; en el sistema sólo hay Firefox).
- **Verificación visual:** SÍ, con **Firefox headless real**
  (`firefox --headless --screenshot`, 390 × 844) sobre `bun run dev`, con datos
  sembrados vía una página temporal (`seed-dev.html`, eliminada después). No es
  una afirmación: hay hallazgos reales corregidos (§7).

## 3. Arquitectura implementada

### 3.1 Entidades separadas (antes mezcladas)

| Entidad | Fichero | Contenido |
| --- | --- | --- |
| `HouseholdProfile` | `src/domain/household/types.ts` | equipos, 3 actividades de cocina, combustible alternativo + política, esenciales de noche, tensión, timestamps. **Sin paneles ni baterías.** |
| `SystemConfiguration` | `src/domain/system/types.ts` | equipo + `params` + `householdProfileId` + `origin` (`user`/`offer`). |
| `SimulationSnapshot` | `storage.ts` | foto inmutable: ids, nombres, kWh/día del hogar, hipótesis y métricas (mediana/peor/mejor/apagón/cocina/noche). |

### 3.2 Suministro eléctrico (§4)

- `gridScenarios.ts`: 24 escenarios deterministas `rt-00`…`rt-23`, ventana
  continua de 3 h (12 intervalos a 15 min), comienzos horarios, **cruce de
  medianoche correcto**, más `blackout` (96 intervalos sin red).
- Todos los escenarios se generan desde `params`: la instalación no puede
  generar un conjunto distinto. `evaluateSystem` corre **exactamente** los
  mismos 25 casos para toda instalación y comportamiento.
- Agregación: mediana, peor, mejor y variación (mejor − peor) + peor energía no
  servida, peor déficit nocturno y peor comidas sin cocinar.

### 3.3 Cocina (§5)

- `cooking.ts` planifica las tres actividades por separado. La **hora de servir**
  y la **hora de preparación** son campos distintos; la preparación se mueve
  dentro de la ventana sin cambiar la hora de comer.
- Combustible alternativo: si la cocción no se cubre con red o sol y la política
  lo permite, se sustituye → **no hay demanda eléctrica** y se informa la energía
  evitada. Políticas: `electric-first`, `fuel-first`, `never`.
- Modo `usual` cocina a la hora preferida; modo `flexible` adelanta dentro de la
  ventana prefiriendo red, luego PV, luego mínimo gasto de batería, sin caer a la
  madrugada si hay alternativa.
- Viabilidad eléctrica: si el inversor/batería no pueden con la potencia, la
  cocción se programa igual y **el motor informa el fallo** (`COOKING_UNMET`).

### 3.4 Reserva nocturna (§6)

- `bridge.ts::socFloorByInterval`: de día el suelo de SOC es
  `minSoc + energía esencial nocturna/(η_desc·η_inv)/kWh nominales`; de noche
  baja al suelo del banco. **No es un porcentaje arbitrario.** Sin esenciales
  marcados no hay reserva (y la app lo dice).

### 3.5 Despacho híbrido (§7) y fin de la exportación (§9)

- Con red disponible: PV → red → batería. La batería **no** se descarga para
  cargas ordinarias; se reserva para los apagones.
- Carga desde red **solo** si el inversor declara `gridChargerW` (nuevo campo
  opcional en `InverterSpec`); 0/ausente = no carga desde red.
- **Exportación eliminada**: `exportedKwh`/`exportedW` y `allowExport` fuera de
  tipos, motor, persistencia y UI. El excedente es `curtailedKwh`.

### 3.6 Oferta integrada (§10)

- `offerReport.ts`: construye las especificaciones desde lo que el vendedor
  declara; lo no declarado queda en `missing` y la verificación global es
  **falsa** (nunca «verificado» por completar la simulación).
- Una sola acción: **«Simular esta oferta en mi vivienda»** → comprobaciones +
  simulación completa; el resultado se recalcula si cambia un dato (la acción se
  rearma) y la oferta se puede guardar como instalación `origin: 'offer'`.

## 4. Persistencia y migración (nadie pierde sus datos)

- Esquema **v3** con clave nueva; `loadState` lee también `:v1`/`:v2` y migra:
  perfiles de equipo → hogares completos (electrodomésticos intactos), y crea
  una instalación con el equipo que el usuario tenía seleccionado (cantidades a
  0, el asistente las pide). El límite de importación antiguo
  (`gridInput.maxPowerW`) se traslada a `params.gridMaxPowerW`.
- Cada hogar, instalación, equipo y parámetro se sanean por separado: un
  registro corrupto se descarta, los válidos se conservan.
- `saveState` persiste con debounce de 350 ms (antes: todo el estado en cada
  tecla). Cuota agotada o JSON inválido → estado utilizable, sin excepción.

## 5. Pantallas

- **Inicio** (`Home.tsx`): dos acciones grandes + «Mis viviendas» (editar,
  renombrar, duplicar, nueva instalación, eliminar con confirmación que explica
  qué se borra) + «Mis instalaciones y simulaciones» (abrir, editar, duplicar,
  eliminar) + «Resultados guardados» (fotos, no cambian).
- **Workflow A** (`HouseholdWizard.tsx` + `StepAppliances` controlado + nuevo
  `StepHabits`): equipos → hábitos (cocina, noche, combustible).
- **Workflow B** (`SystemWizard.tsx`): equipo, cantidades, hipótesis y resumen
  en vivo, con el cargador AC declarado explícito.
- **Resultado** (`Result.tsx`): comportamiento de cocina, 24 casos con tabla
  seleccionable (horas clave resaltadas), apagón total, comodidad de noche,
  SOC de un escenario elegido y comparación de instalaciones del hogar.
- **Oferta** (`OfferCheck.tsx`): selector de vivienda + datos del vendedor +
  acción única + resultado unificado + guardar como instalación.
- Eliminados: `Wizard.tsx`, `StepUsage.tsx`, `StepCompare.tsx`, `StepSystem.tsx`
  (sustituidos) y el módulo de oferta antiguo `offer.ts` + su test.
- `sizing.ts` **se conserva** porque sus pruebas de regresión (C3/C4/C6–C8)
  siguen usándolo; la UI ya no presenta «opciones recomendadas».

## 6. Pruebas (60 → 148)

| Fichero | Pruebas | Cubre |
| --- | --- | --- |
| `test/uiControls.test.tsx` | 8 | **ronda visual**: tarjetas `choice` (opción por defecto seleccionada, radio que no se estira, título + descripción accesibles por opción, cambio de política al pulsar) y `Stepper` (variable `--stepper-steps` con 2 y con 5 pasos, estado completado/actual con `aria-current`) |
| `domain/simulator/gridScenarios.test.ts` | 7 | 24 escenarios, ventanas de 12 intervalos, cruce de medianoche, cobertura completa del día, determinismo, apagón sin red |
| `domain/simulator/cooking.test.ts` | 14 | independencia de comidas, combustible sin demanda eléctrica, cocción con PV sin red, inversor insuficiente, ventana respetada, flexible que aprovecha la red, hora de comer intacta |
| `domain/persistence/storage.test.ts` | 11 | esquema v3, migración v1/v2 con equipos intactos, hogar corrupto aislado, varias instalaciones por hogar, fotos que sobreviven, pasos admitidos, cuota, JSON inválido, MPPT/tensiones |
| `domain/simulator/policy.test.ts` | 16 | batería quieta con red, batería sirve sin red, límite de importación, cargador AC declarado vs ausente, vertido sin exportación, reserva nocturna, cocción en el motor, escenarios idénticos |
| `test/architecture.test.ts` | 14 | evaluación 24+apagón, mediana/peor/mejor/variación, más batería no cambia los hábitos, reserva derivada del consumo real, oferta verificada vs sin datos, oferta sin cargador AC |
| `test/invariants.test.ts`, `phaseA.test.ts`, `engine.test.ts`, resto | 78 | invariantes físicos y regresión de la ronda anterior |

Mutation testing (disciplina de la ronda anterior) sigue vigente: revertir el
presupuesto compartido de descarga o de carga, o la recarga diaria, rompe las
pruebas de `phaseA`/`invariants`.

Las pruebas de componentes se montan de verdad (React 18 + `react-dom/client`
dentro de `happy-dom`); no se usa ninguna librería de consulta. Cada `mount()`
desmonta el anterior para que el DOM consultado sea siempre el recién pintado.

## 7. Verificación visual real (Firefox headless)

Se capturaron **32 escenarios × 4 viewports** (390 × 844, 430 × 932, 768 × 1024,
1440 × 900) más 10 tallas altas para las secciones que no caben en una pantalla
y un volcado del barrido de desbordamiento. Hallazgos **corregidos**:

1. **Radios de «Combustible alternativo» estirados a caja enorme**: la regla
   global `.field input:not([type='radio']):not([type='checkbox']) { width:
   100% }` (y sus variantes `:focus` y `:user-invalid`) se aplicaba a los radios
   del paso 2. La definición tipo caja se eliminó del selector y se reconstruyó
   `.choice` con `grid-template-columns: auto minmax(0, 1fr)`: radio compacto a
   la izquierda, título y descripción a todo el ancho, tarjeta completa
   clicable y estado `.is-on` visible.
2. **Etiquetas anidadas** (inválidas): el grupo de radios iba envuelto en
   `<Field>`, que pinta un `<label>`; dentro había otro `<label>` por opción.
   Sustituido por `<fieldset>` + `<legend>` (`.field--group`, sin borde nativo).
3. **Stepper con columnas fijas**: `.stepper` tenía `repeat(4, 1fr)` codificado.
   Ahora deriva del número real de pasos vía `--stepper-steps`
   (`repeat(var(--stepper-steps, 4), minmax(0, 1fr))`), con `max-width:
   min(100%, calc(var(--stepper-steps, 4) * 9.5rem))` y márgenes automáticos
   para que dos pasos no se separen en pantallas anchas. Verificado a 2 pasos
   (hogar) y a 5 (asistente de sistema), sin romper ninguno.
4. **Desbordamiento horizontal real** en `/resultado`: la tabla de los 24
   escenarios exige 366 px de `min-content` frente a 341 px disponibles, y la
   pista `auto` del grid `.stack` crecía con ella, ensanchando la página entera
   (scrollWidth 423 sobre viewport 378). Arreglo por la causa: `.stack` pasa a
   `grid-template-columns: minmax(0, 1fr)` y las tres tablas se envuelven en
   `.table-scroll` (`overflow-x: auto`) para que se desplacen dentro de su panel
   en lugar de empujar la página.
5. **Orden de CSS**: las reglas `.topbar__inner` y `.topbar__link` estaban
   después de los `@media`, así que pisaban los valores responsive.
6. **Botón Contacto nativo**: sin estilos propios; ahora es `.topbar__link`
   (píldora del sistema de diseño) dentro de una barra alineada con el cuerpo.
7. **Pantalla de inicio**: jerarquía compuesta de nuevo (bloque de valor
   `home-lede`, dos acciones diferenciadas, flujo de tres pasos numerado sin
   repetir tarjetas blancas, fichas de vivienda con 4 cifras, acciones
   escalonadas oscuro + contorno + enlaces, estado vacío deliberado cuando una
   vivienda no tiene instalaciones).

Barrido mecánico de desbordamiento (63 combinaciones ruta × escenario ×
viewport, `overflow-x` propio ignorado a propósito): **`scrollWidth ===
clientWidth` en todas**, sin elementos desbordados de página.

Lo que **no** se puede afirmar: comportamiento táctil real, rendimiento en
dispositivo de gama baja, ni la PWA instalada con la red cortada (no hay
dispositivo ni forma de simular el ciclo de vida completo del service worker
con headless + capturas). Tampoco se verificó con lector de pantalla: el grupo
de radios se expone con `role="radiogroup"` + `aria-label`, los pasos con
`aria-current="step"`, pero no hay prueba auditiva.

**Detector local de Impeccable** (`scripts/impeccable detect --changed`,
determinista, sin API key): 112 hallazgos al inicio → **85** tras las
correcciones (81 `advisory` + 4 `warning`). Los 4 avisos restantes son las
declaraciones `@font-face`, que deben nombrar la familia literalmente (falso
positivo de la regla). Quedan **81 recomendaciones** como deuda documentada:
32 colores, 28 tamaños de fuente y 21 radios que siguen literales dentro del
CSS heredado. Tokenizarlos por completo es una pasada mecánica sobre 830 líneas
de hoja: se deja anotada en `DESIGN.md` en lugar de arriesgar la composición
sin correlación visual previa.

Lo que **no** se puede afirmar: comportamiento táctil real, rendimiento en
dispositivo de gama baja, ni la PWA instalada con la red cortada (no hay
dispositivo ni forma de simular el ciclo de vida completo del service worker
con headless + capturas).

## 7b. Defecto abierto — página de captura vuelve a un estado vacío

**Síntoma:** Firefox con perfil nuevo sembrando vía `seed-dev.html` y abriendo
después `#/instalacion?id=i1` pinta el estado «Primero configura una vivienda»
(guard `!household` en `SystemWizard`), no el asistente. La siembra está
confirmada: el estado sigue en el perfil tras la visita (verificado con
`localStorage`, 1898 bytes), así que no es un fallo de persistencia.

**Causa probable (sin confirmar):** la app carga el estado una sola vez, en
`useState(() => loadState())` de `AppProvider`. La siembra y la captura son
procesos Firefox distintos; si el arranque de la app consume/reescribe el
estado antes de que termine el render, o si `saveState` con `setTimeout` de
350 ms escribe el estado inicial antes de que el usuario vea algo, el estado
guardado se puede pisar con el de arranque.

**Dónde mirar:**
- `src/app/AppContext.tsx` — `useState(() => loadState())` más el
  `useEffect` con debounce de 350 ms que llama a `saveState(state)`.
- `src/domain/persistence/storage.ts` — `loadState()` (validación de hogares,
  migración v1/v2→v3) y `saveState()`.
- `src/screens/SystemWizard.tsx` línea ~57 — el `if (!household)` que muestra
  la pantalla de error.

**Qué reproducir, paso a paso:**
1. Lanzar Firefox headless con un **perfil vacío**.
2. Visitar `http://localhost:5199/seed-dev.html?scenario=with-system&to=%2F`.
3. Visitar `http://localhost:5199/#/instalacion?id=i1` y comprobar si aparece
   el asistente o la pantalla «Primero configura una vivienda».
4. Comparar el `localStorage` **antes y después** de la visita a la app.

Nota: `seed-dev.html` se borró del repo al terminar (era temporal, para las
capturas). Este informe documenta el síntoma por si reaparece con datos
reales: si un usuario ve «Primero configura una vivienda» teniendo hogares
guardados, el fallo está en el arranque de `AppProvider`, no en la siembra.

## 8. Auditoría independiente

Se lanzó un subagente `explore` **de solo lectura** (Agent 5 del encargo) con
comprobaciones explícitas: cambios destructivos en git, conservación de energía
en el motor, datos inventados que se presenten como verificados, escenarios
distintos entre instalaciones, migraciones con pérdida de datos y tests
tautológicos. Su informe se incorpora como **Anexo A** de este documento.

El propio orquestador aplicó además una comprobación mecánica de deuda
(`detect` de Impeccable, §7), la suite completa (148 pruebas), `tsc -b` y el
build de producción como puertas de salida.
2. **Modelo:** balance energético por intervalos con pérdidas agregadas;
   reserva nocturna derivada del consumo declarado; HSP es hipótesis, no dato
   meteorológico. No es un diseño eléctrico certificado ni una garantía.
3. **Cocina:** la viabilidad se decide con reglas transparentes (red, PV neto,
   potencia del equipo); la batería se evalúa con sus límites reales en el
   motor. No hay optimización multi-objetivo ni aprendizaje de hábitos.
4. **Oferta:** sin datos del vendedor la compatibilidad queda sin verificar
   (diseño intencional); la simulación avanza con hipótesis declaradas.
5. **Sin verificar:** toque real, teclado físico, lector de pantalla, PWA
   offline en dispositivo. Recomendado antes de publicar.

## 9. Distinción de estados

| Categoría | Contenido |
| --- | --- |
| **Implementado y probado** | Todo §3–§6, con las 4 puertas de validación en verde |
| **Implementado, verificado sólo en navegador** | Composición visual (capturas Firefox) |
| **Implementado, sin verificar en dispositivo** | Persistencia real en Android, service worker offline, toque |
| **Verificado sin cambios de UI** | Motor físico C1–C8 de la ronda anterior (regresión) |
| **Descartado con justificación** | Exportación a red, escenarios ilustrativos antiguos, opciones recomendadas |
---

## Anexo A — Informe de la auditoría independiente (subagente `explore`, solo lectura)

El subagente no modificó ficheros. Verificó: ausencia de operaciones destructivas
en git (sólo dos `commit` en el reflog), ausencia de imports colgando tras las
bajas, `tsc` limpio y 140 pruebas en verde en el momento de la auditoría (148
tras las pruebas de interfaz de la revisión visual).

### Hallazgos y resolución

| # | Severidad | Hallazgo | Resolución |
| --- | --- | --- | --- |
| 1 | **ALTO** | `maxAcOutputKwh` (potencia nominal del inversor) no se aplicaba a la descarga batería→AC: con inversor de 1 kW y banco de 5 kW se entregaban 3 kW a la carga | **Corregido**: la descarga se limita a la capacidad AC restante del inversor. Test de regresión en `policy.test.ts`, verificado por reversión (el test falla si se quita el límite) |
| 2 | MEDIO | `solarFraction = pvUsedKwh/demanda` llegaba al 193 % porque contaba PV almacenada y nunca entregada (política híbrida) | **Corregido**: nuevo `pvToLoadKwh` y `solarFraction = PV directo a carga / demanda`, con test que verifica ≤ 100 % |
| 3 | MEDIO-ALTO | Instalación migrada con `panelCount: 0` → `needsDesign` era `false` y se simulaba «sin paneles» para siempre | **Corregido**: `needsDesign = panelCount < 1 ‖ batteryCount < 1`, misma condición en `SystemWizard` |
| 4 | MEDIO | Fotos de resultados descartadas en silencio al pasar de 50 | **Documentado** en la pantalla de inicio (límite visible) |
| 5 | MEDIO | Eficiencias por defecto (0,92 / 0,95) sustituidas sin marca de «no verificado» | Se mantuvo la sustitución (necesaria para no dividir por cero) y se añadió `effectiveInverterEfficiency` compartida por reserva y motor (hallazgo 8) |
| 6 | BAJO | La reserva usaba `params.inverterEfficiency` mientras el motor usaba `inverter.efficiency` | **Corregido**: precedencia única |
| 7 | BAJO | La oferta ignoraba el pico de arranque (`peakW = peakSimultaneousW`) | **Corregido**: `peakDesignW` con el arranque más grande, igual que el dimensionado |
| 8 | BAJO | NOCT no declarado se sustituía por 45 sin avisar | Sigue siendo plantilla, pero ahora entra en la lista `missing` → la oferta queda «sin verificar» |
| 9 | BAJO | Energía de cocción medida con dos criterios (duración redondeada vs declarada) | **Corregido**: un solo criterio (duración redondeada al paso) |
| 10 | BAJO | `scenarios.ts`/`analysis.ts` sin consumidores de producto | `scenarios.ts` y su test **eliminados**; `analysis.ts` se conserva porque `sizing.test.ts` lo usa como verificación |
| 11 | — | Tests tautológicos o débiles | **Reforzados**: variación y mediana recalculadas de forma independiente, `recommendedSeries = 0` asertado directamente, `usableKwh = 8 kWh` con valores conocidos, determinismo con sentido, diagnóstico concreto en lugar de OR de códigos, y el test de reserva nocturna reformulado al invariante real (el día falla antes que la noche) |

### Puntos verificados SIN problemas

- **Conservación de energía** en las rutas de demanda y balance (independiente del código revisado).
- **Escenarios homogéneos**: todas las rutas de producto pasan por `evaluateSystem`.
- **Tests bien planteados**: demanda recalculada vs. servida + no servida, ΔSOC vs. carga − descarga, suma por prioridad vs. totales, presupuestos compartidos, cocción y escenarios.

### Suite final

```
bun install --frozen-lockfile   → 107 instalaciones, sin cambios
bun run test                    → 16 ficheros / 140 pruebas, todas en verde
bunx tsc -b                     → exit 0
bun run build                   → dist/ generado (JS 291,93 kB · gzip 91,25 kB)
```
