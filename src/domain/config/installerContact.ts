/**
 * Datos públicos del instalador que se muestran en la aplicación.
 *
 * Este objeto se incluye en el JavaScript público. Los visitantes pueden
 * consultar la información, pero no existe una pantalla para editarla.
 * Para cambiar los datos del sitio oficial hay que modificar este archivo,
 * publicar un commit autorizado y dejar que Cloudflare Pages lo despliegue.
 */
export const PUBLIC_INSTALLER_CONTACT = {
  businessName: 'Chávez_Electrical',
  installerName: 'Marcos Chávez Mesa',
  phone: '+53 53855552', // Sustituye este marcador por tu número internacional.
  services:
    'Montaje de sistemas fotovoltaicos y asesoramiento técnico para la compra de estos.',
  zones: 'La Habana, Cuba',
} as const;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function phoneConfigured(value: string): boolean {
  const digits = digitsOnly(value);
  return digits.length >= 8 && !/X/i.test(value);
}

export function telHref(value: string): string {
  return `tel:+${digitsOnly(value)}`;
}

export function whatsappHref(value: string, message?: string): string {
  const base = `https://wa.me/${digitsOnly(value)}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
