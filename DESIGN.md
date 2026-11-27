---
name: SolarAPP
description: Planificador de instalaciones fotovoltaicas para viviendas en Cuba
colors:
  paper: "#f7f6f0"
  paper-2: "#eeece2"
  surface: "#ffffff"
  forest-900: "#0c2e23"
  forest-800: "#124536"
  forest-700: "#1a5a45"
  lime: "#c9f169"
  lime-ink: "#4b7312"
  sun: "#f2b83e"
  storage: "#23766c"
  demand: "#a94f2f"
  demand-on-dark: "#eba08a"
  grid: "#5c7186"
  ink: "#132a21"
  muted: "#55665c"
typography:
  display:
    fontFamily: "'Instrument Serif', Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  display-hero:
    fontFamily: "'Instrument Serif', Georgia, serif"
    fontSize: "2.9rem"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  stat:
    fontFamily: "'Instrument Serif', Georgia, serif"
    fontSize: "1.85rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.015em"
  body:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.45
  body-emphasis:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.45
  hint:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.45
  eyebrow:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.06em"
  micro:
    fontFamily: "'Space Grotesk', system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 400
    lineHeight: 1.45
  data:
    fontFamily: "'Space Grotesk', monospace"
    fontVariantNumeric: "tabular-nums"
rounded:
  sm: "10px"
  md: "18px"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.7rem"
  md: "1.15rem"
  lg: "1.5rem"
components:
  btn-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.forest-900}"
    rounded: "{rounded.pill}"
    padding: "0.75rem 1.25rem"
    height: "2.75rem"
  btn-quiet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 0.9rem"
    height: "2.4rem"
  panel-paper:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "1.15rem"
  panel-dark:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "1.15rem"
  coverage-pill-good:
    backgroundColor: "#e6f3d9"
    textColor: "#3f5f0d"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.45rem"
  coverage-pill-mid:
    backgroundColor: "#fdf1d8"
    textColor: "#7a5208"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.45rem"
  coverage-pill-bad:
    backgroundColor: "#fbe3dc"
    textColor: "#7d2418"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.45rem"
---

## Overview

SolarAPP se usa en un teléfono Android, en una cocina o en un portal, con el
instalador al lado. La interfaz tiene un trabajo doble: que el cliente entienda
qué puede esperar de una inversión sin ser ingeniero, y que el instalador
encuentre los datos técnicos cuando los busca. Por eso la dirección es
**Solar Tech Editorial**: papel cálido, verde bosque como tinta, una sola
superficie oscura memorable (el diagrama de flujo) y tipografía editorial con
cifras grandes. La audacia se gasta en un sitio; el resto respira.

La app separa cuatro cosas y la interfaz las separa también: configurar la
vivienda, diseñar la instalación, leer el resultado y comprobar una oferta.

## Colors

| Token | Valor | Uso |
| --- | --- | --- |
| `--paper` / `--paper-2` | `#F7F6F0` / `#EEECE2` | Fondo de la app y campos sobre papel |
| `--surface` | `#FFFFFF` | Tarjetas y paneles (también `panel--dark`, que es claro) |
| `--forest-800/900` | `#124536` / `#0C2E23` | Tinta de marca y único escenario oscuro del flujo |
| `--lime` | `#C9F169` | Acento y acción principal; sobre verde profundo (8,4:1) |
| `--lime-ink` | `#4B7312` | Texto lima sobre papel (5,1:1) |
| `--storage` | `#23766C` | Batería, selección, datos técnicos |
| `--demand` / `--demand-on-dark` | `#A94F2F` / `#EBA08A` | Consumo y faltante (5,4:1 sobre blanco) |
| `--sun` | `#F2B83E` | Escenarios clave de la tabla de retorno |
| `--ink` / `--muted` | `#132A21` / `#55665C` | Texto principal y secundario (14,1:1 y 6,1:1) |

Los colores se miden sobre la superficie real, no sobre el fondo general: el
verde lima sólo se usa como texto sobre verde profundo o como acento de acción.

## Typography

Escala tipográfica documentada (los pasos en `rem` que usa la app; el detector
local de Impeccable los compara contra este documento):

| Paso | Tamaño | Uso |
| --- | --- | --- |
| `display-hero` | 2,9rem | Titular del resultado |
| `display` | 2rem | Titulares de sección y pantalla |
| `stat` | 1,85rem | Cifras de los bloques de resultado |
| `body-emphasis` | 1,2rem | Batería instalada, cifras fuertes |
| `body` | 0,95rem | Texto general |
| `label` | 0,86rem | Etiquetas de campo y texto de control |
| `hint` | 0,82rem | Ayudas y descripciones secundarias |
| `caption` | 0,78rem | Texto de tabla y notas pequeñas |
| `eyebrow` | 0,75rem | Antetítulos en versalillas |
| `micro` | 0,72rem | Metadatos y pies |

- **Display:** Instrument Serif para titulares y cifras grandes («100 %»),
  con alineación tabular en los números.
- **Interfaz:** Space Grotesk para etiquetas, botones y texto.
- **Datos:** Space Grotesk con `font-variant-numeric: tabular-nums` para que
  las columnas de la tabla de escenarios no bailen.
- Autoalojadas (`public/fonts`), `font-display: swap`, sin FOUT agresivo.

## Layout

Móvil primero: una columna de 46 rem como máximo, relleno lateral de 1,15 rem y
barra inferior fija con cinco destinos (Inicio, Mi vivienda, Instalación,
Resultado, Catálogo). La acción principal de cada pantalla vive arriba; la
gestión de datos vive abajo, en el inicio.

- **Inicio:** dos acciones grandes (Diseñar mi instalación / Comprobar una
  oferta) y, debajo, «Mis viviendas» y «Mis instalaciones y simulaciones».
- **Vivienda:** dos pasos (Equipos → Hábitos) con stepper accesible.
- **Instalación:** una pantalla continua con resumen en vivo.
- **Resultado:** bloques apilados por pregunta, no por tecnología.
- **Oferta:** formulario arriba, resultado unificado abajo.

## Elevation & Depth

Sombra única y suave (`--shadow: 0 10px 30px rgba(7,30,23,.06)`), filetes de
1 px (`--line`) para separar en lugar de más sombras, y una única superficie
oscura (el diagrama de flujo de energía sobre verde profundo). Nada de
gradientes decorativos ni de sombras apiladas.

## Shapes

Radios de 10 px en controles, 18 px en tarjetas y píldoras completas en chips,
pestañas y badges de cobertura. Las tablas de escenarios usan filetes, no
cajas: 24 filas con cajas serían un bloque gris ilegible.

## Components

- **Stat:** cifra en serif sobre etiqueta en versalillas; en rejillas de cuatro
  lleva filete inferior salvo en la última fila.
- **Segmented:** comportamiento de cocina (habitual / flexible) y franjas.
- **Scenario table:** tabla de los 24 retornos; la fila seleccionada lleva
  banda izquierda de `--storage`; las cuatro horas clave llevan fondo `--sun`
  al 12 %; cada fila tiene píldora de cobertura (bien / regular / mal) y es
  seleccionable por puntero y por teclado (Enter / Espacio).
- **Meal editor:** `<details>` por comida con resumen legible (hora de servir,
  potencia, duración) y cuerpo editable (ventana, potencia, duración,
  imprescindible).
- **Install row:** fila de instalación guardada con equipo y acciones.
- **Toast / Note:** avisos accesibles con `role="status"` y `aria-live`.
- **BatteryRing / SocChart / EnergyFlow:** visualizaciones SVG con datos
  reales del simulador; nunca curvas inventadas.

## Do's and Don'ts

- **Sí:** mostrar el peor caso al mismo nivel que el caso típico; usar
  «N/D» cuando algo no aplica; explicar en una línea qué significa cada cifra.
- **Sí:** texto lima sólo sobre verde profundo; `--demand` sobre blanco.
- **No:** emoji como iconografía, gradientes decorativos, tarjetas idénticas
  repetidas, ni animaciones que no informen.
- **No:** afirmar «verificado» cuando faltan datos del equipo: se dice «sin
  verificar» y se lista lo que falta.
- **No:** presentar una simulación como garantía: es una estimación con
  hipótesis declaradas.

## Accesibilidad y movimiento

WCAG 2.2 AA como objetivo práctico: contraste medido sobre la superficie real,
objetivos táctiles ≥ 2,4 rem, foco visible uniforme, pestañas y stepper con
ARIA correcto, foco al `<main>` al cambiar de ruta y `aria-current="page"` sólo
en la ruta real. `prefers-reduced-motion: reduce` desactiva animaciones,
transiciones y desplazamiento suave también desde JavaScript.

## Verificación visual

Las capturas de esta revisión se hicieron con **Firefox headless real**
(`firefox --headless --screenshot`, 390 × 844) sobre el servidor de desarrollo,
con datos sembrados. Los hallazgos se corrigieron en el código: la etiqueta
obsoleta «Paso 1 de 4» del asistente de vivienda y los plurales
«instalación(es)». No se usa Chrome: la instalación de Flatpak del sistema no
proporciona binario de Chrome.