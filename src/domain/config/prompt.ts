/** Prompt para que el usuario consiga los datos de un equipo con una IA o Google. */
export const SPEC_PROMPT = `Necesito las especificaciones técnicas exactas del equipo [marca y modelo, o pega aquí el enlace al anuncio o ficha del producto] para comprobar su compatibilidad en una instalación solar doméstica.

Devuélveme una tabla con los datos que correspondan:
- Panel solar: potencia STC (W), Vmp, Imp, Voc, Isc, coeficiente térmico de Voc y de potencia (%/°C), NOCT.
- Inversor híbrido: potencia continua y de arranque (W), eficiencia, entrada fotovoltaica máxima (W y V), rango de tensión y corriente máxima de cada MPPT, tensión de batería, corriente máxima de carga y descarga, tensiones AC admitidas.
- Batería: capacidad real (kWh y Ah), tensión nominal, potencia máxima de carga y descarga (W), química y profundidad de descarga recomendada.

Para cada dato indica la fuente. Si no aparece en la ficha del fabricante, escríbelo como «no verificado». No inventes valores.`;
