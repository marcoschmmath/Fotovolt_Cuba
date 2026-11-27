# SolarAPP — guía de aplicación del rediseño

## Qué incluye esta iteración

Esta entrega adapta la interfaz existente a la dirección visual de la referencia móvil de seis pantallas. No sustituye el motor energético ni rehace la arquitectura de datos.

- **Inicio:** hero editorial, ilustración independiente de una vivienda cubana con paneles, dos acciones principales, ventajas y gestión de viviendas/instalaciones/resultados guardados.
- **Navegación:** cuatro destinos inferiores: Inicio, Simular, Resultados y Más. Las rutas antiguas de catálogo, contacto y comprobación de ofertas permanecen accesibles desde Más.
- **Vivienda:** asistente en tres pasos —Equipos, Hábitos, Resumen—. La vivienda continúa siendo independiente de cada instalación.
- **Equipos:** filtro «Todos», filas de selección y edición detallada. Las actualizaciones se aplican funcionalmente sobre el último estado para evitar que cambios rápidos se pisen.
- **Hábitos:** desayuno, almuerzo y comida/cena en tarjetas compactas; combustible alternativo y preparación flexible; selección de equipos esenciales nocturnos.
- **Sistema fotovoltaico:** conserva la edición técnica y la asociación a una vivienda. Entrar con `?hogar=<id>` crea otra instalación para esa vivienda; entrar con `?id=<id>` edita la instalación identificada.
- **Simulación:** nueva pantalla intermedia con escenario representativo, reproductor Play/Pausa, paso, velocidad y control temporal. El escenario inicial es el retorno de red de 14:00 a 17:00 (`rt-14`), pero no se pide al usuario que prediga el horario real de los apagones. La corrida se ordena desde las 08:00 hasta las 08:00 del día siguiente (96 intervalos de 15 min) y parte de un SOC del 30 %, o del mínimo físico de la batería si este es mayor.
- **Diagrama energético:** React + SVG + CSS, alimentado por los resultados reales del motor. El componente solo representa cada intervalo y no vuelve a ejecutar el simulador durante la reproducción.
- **Resultados:** pestañas Resumen, Escenarios y Detalle, con métricas calculadas y acceso a la simulación. La etiqueta «Sistema compatible con esta vivienda» exige cobertura completa en los 24 horarios representativos de red, SOC final no inferior al SOC de partida y ninguna comida eléctrica sin cubrir; el apagón completo de 24 h se informa por separado como prueba de estrés.
- **Rutas inválidas:** un ID explícito de instalación que no existe muestra un estado de instalación no encontrada; no recurre silenciosamente a la instalación activa.

## Diagrama: separación de magnitudes

El adaptador `src/ui/simulation/energyFlowAdapter.ts` toma los campos publicados por `IntervalResult` y los pasa al contrato visual. Distingue:

- Producción PV del array en DC.
- PV entregada a cargas en AC.
- Potencia almacenada en la batería.
- Importación de red para cargas y para el cargador, ambas en AC.
- Descarga de batería hacia las cargas en AC.
- Demanda, energía servida y energía no suministrada en AC.
- SOC, recorte PV y energía PV no aprovechada.

No se suman directamente potencias AC, DC y del lado de almacenamiento para fabricar un total. `frameTotals()` solo suma las dos partidas de importación que pertenecen a la misma frontera AC. Se añadió una prueba del adaptador para comprobar el mapeo de los campos del motor.


## Condiciones de simulación y cocina (ajuste 08:00–08:00)

- Cada escenario empieza a las **08:00** y termina a las **08:00 del día siguiente**. Con paso de 15 minutos se recorren 96 intervalos. Las series diarias (demanda, generación solar, red y reserva) se indexan por la hora civil, mientras que los frames se presentan en orden cronológico desde las 08:00.
- El SOC inicial es `max(30 %, SOC mínimo físico de la batería)`. No se supone que la batería haya pasado la noche sin uso ni se empieza al 100 %. La interfaz muestra el valor real aplicado cuando el límite de profundidad de descarga obliga a empezar por encima del 30 %.
- Los 24 escenarios habituales conservan sus ventanas de 3 horas de red. La evaluación considera sostenible el día si cada escenario termina con al menos el SOC inicial. El apagón total de 24 horas es una prueba de estrés separada; no se mezcla con la etiqueta de compatibilidad de los 24 escenarios habituales.
- Si no hay combustible alternativo **confirmado**, desayuno, almuerzo y comida se mantienen como demanda eléctrica obligatoria. La reserva nocturna se puede consumir durante esos intervalos hasta el mínimo físico de la batería. Si el inversor, la batería o la energía disponible no bastan, se registra demanda no suministrada; nunca se elimina la comida para proteger la reserva.
- En versiones anteriores «Gas» era el combustible predeterminado. Los perfiles antiguos que conservaban ese valor se restauran como **no confirmados**: hasta que el usuario vuelva a tocar Gas/Carbón/Otro y lo confirme, SolarAPP no supondrá que ese combustible existe. Seleccionar «No tengo» mantiene la cocina como demanda eléctrica obligatoria.
- Las viviendas nuevas incluyen una carga orientativa editable de **dos teléfonos**, 10 W por teléfono durante 2 h nocturnas. Los perfiles ya guardados no se alteran automáticamente: se puede añadir en Equipos → Comunicaciones, ajustar cantidad/potencia/horas o quitarla.
- El reproductor muestra los equipos programados en cada intervalo y su potencia media estimada. Es la demanda que la vivienda solicita; si el inversor o las fuentes no pueden suministrarla, se indica que parte quedó sin cubrir.
- El SVG del diagrama separa las rutas PV→vivienda, red→vivienda, PV→batería, red→batería y batería→vivienda en tramos independientes con flechas propias y corredores distintos. El diagrama representa los flujos medidos por el motor, no calcula balances.

## Archivos principales modificados

- `src/App.tsx`: shell, rutas, cabecera y navegación inferior.
- `src/screens/Home.tsx`: portada y gestión de datos existentes.
- `src/screens/HouseholdWizard.tsx` y `src/screens/wizard/StepAppliances.tsx`, `StepHabits.tsx`: asistente de vivienda y sus pasos.
- `src/screens/SystemWizard.tsx`: creación/edición de instalaciones y transición a Simulación.
- `src/screens/Simulation.tsx`: nueva pantalla de reproducción.
- `src/screens/Result.tsx`: resumen y detalle de resultados.
- `src/app/useCalculation.ts`: resolución estricta cuando se solicita un ID de instalación.
- `src/app/useCalculation.test.ts`: pruebas de resolución de instalación por ID y de ID inexistente.
- `src/ui/simulation/*`: contrato visual, adaptador, diagrama, reproductor y lista de cargas activas.
- `src/domain/simulator/engine.ts`, `cooking.ts`, `scenarioGrid.ts`: orden 08:00–08:00, SOC inicial, cocina obligatoria sin combustible y reserva nocturna.
- `src/domain/household/types.ts`, `src/domain/persistence/storage.ts`, `StepHabits.tsx`: confirmación del combustible para no heredar el antiguo valor predeterminado de gas.
- `src/domain/catalog/appliances.ts`, `HouseholdWizard.tsx`, `StepAppliances.tsx`: plantilla editable de carga de teléfonos móviles.
- `src/styles.css`: tokens y composición visual.
- `public/images/solar-home-hero.svg`: ilustración vectorial independiente que puedes reemplazar por tu propia ilustración. `src/screens/Home.tsx` la carga mediante `src="/images/solar-home-hero.svg"`; puedes sobrescribir el archivo conservando el nombre o cambiar el `src` a `/images/mi-casa.webp` tras copiar tu imagen a `public/images/mi-casa.webp`.

No se añaden dependencias ni se modifica el lockfile.

## Aplicar los cambios sobre tu copia de CachyOS

El archivo `SolarAPP-overlay-cambios.tar.gz` contiene únicamente archivos nuevos/modificados y esta guía. Antes de extraerlo sobre tu repositorio real:

```fish
cd /ruta/a/SolarAPP
git status --short
# Guarda aparte cualquier trabajo local sin commit antes de sobrescribir archivos.
git diff --binary > /tmp/solarapp-antes-del-rediseno.patch
```

Revisa especialmente los archivos modificados que ya tengas editados localmente. Después aplica el overlay desde el directorio donde descargaste el paquete:

```fish
tar -xzf /ruta/a/SolarAPP-overlay-cambios.tar.gz -C .
```

El overlay no contiene `.git`, `node_modules`, variables de entorno ni lockfiles. No extraigas el paquete completo `SolarAPP-redisenado-completo.tar.gz` encima de tu carpeta de trabajo si ya tienes cambios locales: ese paquete es una copia íntegra de la versión que revisé, sin historial Git.

## Verificación local

Desde la raíz del proyecto, con Bun:

```fish
bun install --frozen-lockfile
bun run test
bunx tsc -b
bun run build
bun run dev
```

Comprueba como mínimo estos tamaños en el navegador: 390×844, 430×932, 768×1024 y 1440×900. Revisa en particular el scroll vertical con la barra inferior fija, las filas de equipos, los controles de cocina, la reproducción del diagrama y las tablas de escenarios.

## Estado de validación de esta entrega

- Se hizo un análisis sintáctico de los 67 archivos TypeScript/TSX incluidos: cero diagnósticos de sintaxis.
- Se añadieron pruebas unitarias del adaptador del diagrama y de la resolución de instalaciones; también se actualizaron las pruebas relacionadas con los frames y el SVG.
- **No pude ejecutar Vitest, el typecheck semántico ni el build en este entorno:** Bun y las dependencias del proyecto no estaban disponibles aquí; la restauración de dependencias con npm agotó el tiempo. Por tanto, esos comandos deben ejecutarse en tu CachyOS antes de considerar el cambio validado.
- Tampoco se pudo comprobar el resultado en un navegador real ni en Android físico. La fidelidad visual necesita una pasada de ajuste con capturas reales después de ejecutar la aplicación.

## Siguiente pasada recomendada

1. Ejecutar los cuatro comandos de verificación y corregir cualquier error de tipos o test.
2. Comparar capturas reales con la referencia en 390×844 y 430×932; ajustar tamaños, espacios y recortes de la ilustración.
3. Conectar el flujo de Simulación/Resultados a los datos guardados y revisar escenarios con un caso de referencia calculado a mano.
4. Probar PWA offline y navegación táctil en Android.
5. Más adelante, añadir una pequeña vista previa animada del diagrama en Inicio si quieres recuperar también esa parte de la experiencia de producto.
