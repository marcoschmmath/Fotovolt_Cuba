import { PUBLIC_INSTALLER_CONTACT, phoneConfigured, telHref, whatsappHref } from '../domain/config/installerContact';
import { Badge, Button, Note, Panel, SectionTitle, Toast, useClipboard } from '../ui/components';
import { Icon } from '../ui/icons';

/** Página pública de contacto: los datos se editan en installerContact.ts
 * y se despliegan con una nueva versión de la aplicación.
 */
export function Contact() {
  const clipboard = useClipboard();
  const contact = PUBLIC_INSTALLER_CONTACT;
  const configured = phoneConfigured(contact.phone);
  const whatsappMessage = 'Hola, quisiera información sobre una instalación fotovoltaica para mi vivienda.';

  function shareContact() {
    const text = [
      contact.businessName,
      contact.installerName,
      contact.services,
      configured ? `Teléfono y WhatsApp: ${contact.phone}` : 'Teléfono pendiente de configurar.',
    ].join('\n');
    clipboard.copy(text);
  }

  return (
    <>
      <SectionTitle
        eyebrow="Contacto y contratación"
        title="Hablemos de tu instalación"
        description="Consulta los servicios y contacta directamente con el instalador para resolver tus dudas o solicitar una evaluación."
      />

      <Panel tone="paper">
        <div className="installer-card">
          <div className="installer-card__logo" aria-hidden="true">
            <Icon name="sun" size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <h3>{contact.businessName}</h3>
            <p>{contact.installerName}</p>
          </div>
          <Badge tone="solar">Montaje</Badge>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontSize: '.9rem' }}>{contact.services}</p>
          <p style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            <Icon name="home" size={14} /> {contact.zones}
          </p>
          <p className="installer-contact__phone" style={{ marginTop: '.85rem', fontSize: '.95rem' }}>
            <strong>Teléfono y WhatsApp:</strong>{' '}
            {configured ? <a href={telHref(contact.phone)}>{contact.phone}</a> : 'Número pendiente de configurar'}
          </p>
        </div>

        <div className="commercial__actions" style={{ marginTop: '1rem' }}>
          <Button
            variant="dark"
            icon="phone"
            disabled={!configured}
            onClick={() => { window.location.href = telHref(contact.phone); }}
          >
            Llamar ahora
          </Button>
          <Button
            variant="dark"
            icon="whatsapp"
            disabled={!configured}
            onClick={() => window.open(whatsappHref(contact.phone, whatsappMessage), '_blank', 'noopener,noreferrer')}
          >
            WhatsApp
          </Button>
          <Button variant="dark" icon="share" onClick={shareContact}>
            Compartir contacto
          </Button>
        </div>

        {!configured && (
          <Note level="warning" title="Falta configurar el teléfono">
            Antes de publicar, sustituye <strong>+53XXXXXXXX</strong> por tu número real en{' '}
            <code>src/domain/config/installerContact.ts</code>. Ese mismo número se utilizará para llamadas y WhatsApp.
          </Note>
        )}
      </Panel>

      <Toast message={clipboard.message} tone={clipboard.error ? 'error' : 'info'} />

      <Note level="info" title="Contacto directo">
        SolarAPP no requiere crear una cuenta. Al llamar o escribir por WhatsApp, se abrirá la aplicación correspondiente.
      </Note>
    </>
  );
}
