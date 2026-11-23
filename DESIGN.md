# Sistema de diseño — Luz solar editorial (revisión 2)

## Dirección artística

Segunda iteración tras la revisión del usuario: la interfaz anterior era
demasiado oscura. La nueva dirección mantiene la personalidad editorial pero
deja que entre la luz. El verde profundo deja de ser un fondo masivo y pasa a
ser tinta, acento y *único* escenario del diagrama de flujo.

> Principio de esta revisión: gastar la audacia en un solo lugar. El lienzo es
> claro y tranquilo; la pieza memorable es el flujo de energía, que sí vive
> sobre verde profundo. El resto respira papel, blanco y reglas finas.

## Plan antes de construir (skill frontend-design, dos pasos)

**Color (tokens base):** papel cálido `#F7F6F0`, blanco `#FFFFFF`, verde
profundo `#124536`, Verde bosque `#0C2E23`, lima solar `#C9F169`, lima tinta
`#6F941F`, teal almacenamiento `#23766C`, terracota consumo `#B85E3C`.

**Tipografía:** Instrument Serif para titulares y cifras grandes; Space
Grotesk para interfaz y datos numéricos. Dos familias claramente distintas,
autoalojadas, con `font-size-adjust: from-font`.

**Composición:** columna de lectura de 46 rem, márgenes generosos, tarjetas
con una sola jerarquía de borde y radio. La portada es un panel verde claro
con el sol dibujado a la derecha; la guía de uso son páginas deslizables con
puntos; los resultados son papel salvo el escenario del flujo.

**Revisión contra la plantilla genérica:** se descartó el hero oscuro con
acento ácido (típico de apps generadas), las tarjetas blancas idénticas con
la misma sombra y los eyebrow en mayúsculas. En su lugar: titular serif
grande alineado a la izquierda, superficies claras con reglas en vez de
sombras, y una sola pieza oscura con movimiento.

**Principios:** claridad sobre densidad · el color significa energía · una
sola pantalla protagonista · navegación por páginas y pasos, no por muros de
texto · cada cifra lleva unidad y explicación.

## Tokens

| Token | Valor | Uso |
| --- | --- | --- |
| `--paper` | `#F7F6F0` | Fondo general |
| `--surface` | `#FFFFFF` | Tarjetas y paneles |
| `--ink` | `#132A21` | Texto principal |
| `--forest` | `#124536` | Tinta de acento, botones |
| `--forest-deep` | `#0C2E23` | Escenario del flujo, barra inferior |
| `--hero` | `#DDEEE2` | Panel de portada |
| `--lime` | `#C9F169` | Energía solar sobre fondo oscuro |
| `--lime-ink` | `#6F941F` | Energía solar sobre fondo claro |
| `--storage` | `#23766C` | Batería |
| `--demand` | `#B85E3C` | Consumo |
| `--grid` | `#5C7186` | Red eléctrica |
| `--muted` | `#55665C` | Texto secundario |
| `--line` | `rgba(19,42,33,.14)` | Reglas |

Contraste: `--muted` sobre papel ≥ 5.4:1; `--lime-ink` sobre papel ≥ 4.6:1;
texto claro sobre `--forest-deep` ≥ 10:1.

## Movimiento y navegación

- Guía de inicio y «Cómo funciona»: páginas deslizables con `scroll-snap`,
  indicador de puntos y botones anterior/siguiente.
- El asistente permite deslizar entre pasos y tocar cualquier etiqueta del
  indicador para saltar a ese paso.
- Sólo el diagrama de flujo tiene animación automática, con control de pausa.
- Todo movimiento se activa bajo `prefers-reduced-motion: no-preference`.

## Honestidad visual

Igual que en la revisión 1: plantillas marcadas, hipótesis visibles, sin
precios inventados y sin promesas de autonomía garantizada.
