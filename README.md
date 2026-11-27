# Calculadora Solar Cuba

PWA (mobile-first) para que una persona en Cuba estime qué instalación
fotovoltaica necesita: paneles, baterías e inversor, con simulación de
apagones, comparación de instalaciones y contacto directo con el instalador.

**Cómo se usa:** configuras tu **vivienda** una sola vez (equipos, cocina,
qué necesitas de noche) y después puedes diseñar y comparar tantas
**instalaciones** como quieras contra ese mismo consumo. Cada simulación
evalúa **24 horas de retorno de la luz** (ventanas de 3 h, una por hora,
incluida la que cruza la medianoche) más un **apagón total de 24 h**, con dos
comportamientos de cocina: el habitual y el flexible.

**Estado:** versión 1 funcional. Los cálculos son estimaciones preliminares y
no sustituyen un diseño eléctrico ni una visita técnica.

## Ejecutar

Requiere Node 20+.

```bash
bun install --frozen-lockfile
bun run dev        # desarrollo
bun run test       # 140 pruebas del dominio, la simulación y la persistencia
bun run build      # genera dist/ (PWA lista para desplegar)
bun run preview    # sirve dist/ localmente
```

Para instalarla en un teléfono Android: sirve `dist/` por HTTPS (o `localhost`
durante las pruebas), abre la URL en Chrome y usa «Añadir a pantalla de inicio».
El service worker guarda la aplicación y sus fuentes: después de la primera
carga funciona sin conexión y todos los cálculos se ejecutan en el dispositivo.
Si publicas una actualización, incrementa `VERSION` en `public/sw.js` para
renovar la caché.

## Información pública del instalador

Los datos de contacto se definen en `src/domain/config/installerContact.ts`.
Sustituye allí el marcador de teléfono por el número real con prefijo
internacional `+53`. La misma información alimenta los botones de llamada,
WhatsApp y compartir contacto. No existe una pantalla pública para editarla ni
se guarda en el almacenamiento local de los visitantes.

Para cambiar la información del sitio oficial hay que modificar el código,
subir un commit al repositorio autorizado y dejar que Cloudflare Pages publique
la nueva versión. Los visitantes pueden hacer forks o copias propias del
proyecto, pero eso no modifica el sitio oficial.

El resumen de «Solicitar presupuesto» se abre en `https://wa.me/...` con
consumo diario, potencia simultánea, autonomía, paneles, batería, inversor y
opción elegida. No se piden datos personales al usuario.

## Equipos que piensas comprar

El instalador **no vende equipos**: sólo los monta. En la pestaña **Equipos**
(`Paneles → Baterías → Inversores`) cada persona añade las características de
los modelos que piensa comprar. Hay modelos de ejemplo con datos tomados de
fichas técnicas y enlace a su procedencia (`src/domain/catalog/verifiedEquipment.ts`);
la disponibilidad en Cuba debe verificarse al comprar.

Si no se conoce un parámetro, la propia pantalla muestra un prompt listo para
copiar en Google o en una IA: pide la tabla de especificaciones y exige indicar
la fuente y marcar como «no verificado» lo que no conste en la ficha.

Cada visitante puede personalizar su catálogo local: añadir, editar o quitar equipos.
Los cambios se guardan en su propio navegador y no alteran el catálogo inicial ni
la información pública del instalador. Los precios son opcionales (USD o CUP).

## Perfiles de equipos

En el paso 1 se pueden crear, duplicar, renombrar y eliminar **perfiles**
(cada casa o escenario) sin perder los demás. Los equipos se guardan
automáticamente en el perfil activo y todo permanece en el almacenamiento local.
La portada enlaza con cada paso de la guía y permite deslizar entre pasos o
tocar las etiquetas del indicador.

## Escenarios y recarga

El simulador calcula la autonomía de la carga imprescindible sin sol ni red y
el tiempo estimado de recarga completa desde el SOC mínimo (con sol+red y
sólo con paneles), que se muestra en resultados y en la comparación. La
temperatura mínima por defecto es 18 °C, acorde con el clima cubano, por lo
que en «Comprobar una oferta» no se pide el Voc: se revisan potencia, arranque,
baterías (cantidad y parámetros de cada una) y límites del inversor.

## Arquitectura

```
src/
  domain/
    core/          Tipos, parámetros centralizados y plantillas de referencia
    calculator/    Energía, batería, PV, inversor, dimensionamiento y comparación
    simulator/     Simulación temporal, escenarios, red, análisis y ofertas
    catalog/       Catálogo de electrodomésticos
    config/        Datos públicos de contacto
    persistence/   Almacenamiento local versionado
  app/             Contexto de estado, hook de cálculo, routing e install prompt
  ui/              Iconos SVG, componentes y gráficos (sin dependencias de charts)
  screens/         Pantallas y pasos del asistente
public/            Manifiesto, service worker, fuentes e iconos
```

La interfaz **nunca** calcula física: consume los resultados de `useCalculation`.
El motor y la simulación son módulos puros y están cubiertos por pruebas.

### Motor

- `E_d = Σ(Pᵢ·nᵢ·hᵢ)/1000`, `E_n` según franja horaria, con perfiles constante,
  cíclico y modular, prioridades y factores de arranque.
- `C_b = E_n·A/(DoD·η)` y `P_FV = E_d·F/(HSP·η_sistema)` como estimaciones
  iniciales; la potencia y la energía se tratan por separado.
- Inversor: potencia continua, arranque, corriente de descarga, tensión de la
  vivienda y del banco de baterías.
- Paneles: Ventana del MPPT, `Voc` en frío, `Vmp` en caliente, corriente y
  potencia máxima por MPPT.
- Simulador discreto de 15 min con balance energético conservado, límites de
  SOC, prioridades de carga, red cubana configurable y pérdidas.
- Tres escenarios ilustrativos (favorable / habitual / desfavorable), no
  probabilidades.

Todos los parámetros (HSP, eficiencias, DoD, factor de seguridad, sombras,
temperatura, EER para BTU/h, potencia de red…) están centralizados en
`src/domain/core/defaults.ts` y son editables desde el paso 3.

## Honestidad de los resultados

- Los datos solares son hipótesis configurables, no mediciones de localidades cubanas.
- Las potencias de electrodomésticos son valores típicos editables, no datos de placa.
- La conversión BTU/h → W usa un EER configurable y se marca como aproximada.
- Las capacidades de las tarjetas comparativas son objetivos derivados del consumo;
  se indica cuántos módulos reales del catálogo harían falta.
- Toda pantalla de resultados muestra hipótesis, fórmulas, procedencia y límites.
- No se recomienda ninguna combinación que exceda los límites técnicos declarados.

## Diseño

Ver `DESIGN.md` para la dirección artística «Luz solar editorial» (revisión
clara), tokens, tipografía autoalojada, reglas de movimiento y accesibilidad.
La revisión aplicó la skill `frontend-design` en dos pasos: plan de tokens y
composición, y crítica contra los rasgos genéricos; se descartaron los fondos
oscuros masivos en favor de papel claro con un único escenario oscuro para el
flujo de energía.

Se aplicaron las guías de **frontend-design** (Anthropic) para la dirección
visual deliberada y de **modern-web-guidance** (Google/Chrome) para controles
nativos, escala de texto del sistema, fuentes estables, instalación web y
movimiento reducido. Google Stitch no se utilizó: requiere un servidor MCP
externo no disponible en este entorno.
