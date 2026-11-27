# SolarAPP — datos parciales de equipos y configuración de instalación

**Fecha:** 26 de noviembre de 2026
**Tipo de entrega:** overlay incremental para el proyecto SolarAPP existente.

## Qué cambia

### 1. Datos mínimos y opcionales

La configuración de instalación y el alta manual de equipos distinguen entre datos básicos y datos técnicos complementarios.

| Equipo | Datos básicos necesarios para simular |
|---|---|
| Panel | Potencia nominal (W) |
| Batería | Capacidad nominal (kWh) y tensión nominal (V) |
| Inversor | Potencia continua (W), potencia PV máxima admitida (W) y tensión del banco de baterías (V) |

Los demás campos permanecen opcionales: Voc, Vmp, Isc, Imp, coeficientes térmicos, NOCT, eficiencia, potencia de pico, límites de carga y descarga, DoD, tensiones AC y características de MPPT.

Los campos opcionales vacíos se guardan como `0` —el sentinel de desconocido que ya utiliza el dominio—. No se rellenan como si fueran especificaciones de fabricante.

### 2. Hipótesis explícitas para simular

Cuando faltan datos de eficiencia, DoD o límites de batería, los cálculos energéticos recurren a los parámetros configurables de SolarAPP y a las hipótesis ya definidas en el dominio. El motor de batería mantiene la hipótesis conservadora de 0,2 C cuando no existe un límite BMS de carga/descarga disponible.

No se inventan Voc/Vmp ni límites de tensión, corriente o potencia de MPPT. Sin esos datos se puede realizar la estimación energética usando la potencia PV máxima anunciada, pero la configuración de strings queda como **pendiente de verificación**.

La falta de potencia de cargador AC no se compensa inventando un valor: para evitar sobreestimar la recarga, SolarAPP no cuenta con carga de batería desde la red si no se declara esa capacidad.

### 3. Verificación automática del campo fotovoltaico

No se añadió una interfaz para que el usuario diseñe strings, conexiones serie/paralelo ni cableado.

`checkBalancedArrayConfiguration()` busca automáticamente una distribución que cumpla:

- Todos los strings tienen el mismo número de paneles en serie.
- La cantidad total de paneles se distribuye en strings completos.
- Cada MPPT conserva sus propios límites de tensión, corriente y potencia.
- Los strings se reparten lo más equitativamente posible entre los MPPT usados: la diferencia entre el número de strings asignados a dos entradas utilizadas no supera uno.
- Se utiliza un MPPT solamente cuando sus límites documentados admiten esa configuración.

Si faltan datos suficientes de panel o MPPT, el estado es `insufficient`/verificación parcial, no `incompatible`. Si los límites conocidos demuestran que no existe una configuración admisible, se registra una incompatibilidad.

El dimensionamiento automático utiliza la potencia PV máxima anunciada cuando faltan límites de MPPT, pero conserva la advertencia de que la conexión no ha sido verificada. Con datos completos, utiliza la comprobación equilibrada multi-MPPT.

### 4. Estados de compatibilidad

La evaluación separa la suficiencia energética de la verificación técnica:

- `verified`: no se detectan incompatibilidades conocidas y se han podido comprobar los aspectos técnicos modelados.
- `partial`: la simulación energética puede continuar, pero faltan datos para verificar uno o más aspectos eléctricos.
- `incompatible`: existe al menos una incompatibilidad conocida.

La pantalla de resultados distingue entre cobertura energética favorable con datos verificados, cobertura favorable con verificación parcial e incompatibilidades técnicas conocidas. Un buen resultado energético no se presenta como una certificación de instalación.

### 5. Alta de equipos no listados

Desde la pantalla de instalación el usuario puede añadir localmente un panel, batería o inversor que no aparezca en el catálogo. Se solicitan solo los datos básicos; las especificaciones complementarias se muestran en una sección opcional. El elemento se guarda en el catálogo local y queda seleccionado en la instalación.

La pantalla de catálogo también presenta los campos básicos y opcionales por separado. Las fichas muestran una indicación del nivel de información disponible.

### 6. Contacto profesional

La pantalla de instalación incluye una aclaración para no adivinar valores técnicos y un acceso a `/contacto`, reutilizando la información de contacto existente en SolarAPP. No se crea ni se inventa información de contacto adicional.

## Archivos del overlay

- `src/domain/calculator/inverter.ts`
- `src/domain/calculator/inverter.test.ts`
- `src/domain/calculator/pv.ts`
- `src/domain/calculator/pv.test.ts`
- `src/domain/calculator/sizing.ts`
- `src/domain/simulator/analysis.ts`
- `src/domain/simulator/offerReport.ts`
- `src/screens/Catalog.tsx`
- `src/screens/Result.tsx`
- `src/screens/SystemWizard.tsx`
- `src/screens/system/ManualEquipmentForm.tsx` (nuevo)
- `src/styles.css`

## Aplicación en CachyOS / Fish

Desde la raíz del repositorio:

```fish
cd /run/media/m2ch/912fbb43-56aa-4b7d-905c-8316396e9bb1/ProyectosRandom/SolarAPP

# Revisa cambios locales antes de sobrescribir archivos
git status --short

# Copia de seguridad del diff de archivos rastreados
git diff --binary > /tmp/solarapp-antes-ajustes-catalogo.patch

# Extrae el overlay en la raíz del proyecto
tar -xzf /ruta/a/SolarAPP-overlay-instalacion-2026-11-26.tar.gz -C .

# Validación local
bun run test
bunx tsc -b
bun run build

# Ejecutar
bun run dev
```

No uses `git reset --hard` ni `git clean`. El overlay reemplaza los archivos listados; revisa las diferencias si has editado alguno localmente.

## Validación realizada en esta entrega

- 68 archivos `.ts`/`.tsx` analizados con el parser de TypeScript: cero errores sintácticos.
- Chequeo `tsc --noEmit --strict` de los módulos de dominio modificados: completado sin errores.
- La comprobación multi-MPPT y el escalado del límite BMS por número de baterías fueron probados mediante pruebas unitarias añadidas y pruebas de humo de los módulos puros.
- **No se ejecutaron Vitest completo, `tsc -b` del proyecto ni `vite build` en este entorno** porque la copia de trabajo no tiene `node_modules` y no hay Bun instalado. Deben ejecutarse en el equipo del usuario con los comandos anteriores.

## Advertencias del modelo

- Las baterías se consideran unidades idénticas conectadas en paralelo a la misma tensión nominal. No se modela un banco en serie para elevar tensión.
- La comprobación automática del array solo puede verificar los límites que están documentados. Un MPPT sin datos no se trata como si aceptara cualquier string.
- La ausencia de una incompatibilidad detectada no equivale a aprobación eléctrica, dimensionamiento de protecciones, cálculo de cables, puesta a tierra ni permiso para conectar los equipos. Antes de instalar deben verificarse las placas, manuales y protecciones con un profesional.
