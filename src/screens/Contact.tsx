import { useState } from 'react';
import { useApp } from '../app/AppContext';
import type { CommercialConfig } from '../domain/config/commercial';
import { phoneConfigured, telHref, whatsappHref } from '../domain/config/commercial';
import { Badge, Button, Note, Panel, SectionTitle, TextField } from '../ui/components';
import { Icon } from '../ui/icons';

export function Contact() {
  const { state, patch } = useApp();
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [draft, setDraft] = useState<CommercialConfig | null>(null);
  const commercial = state.commercial;

  function set<K extends keyof CommercialConfig>(key: K, value: CommercialConfig[K]) {
    setDraft((current) => ({ ...(current ?? commercial), [key]: value }));
  }

  function unlock() {
    if (pinInput === commercial.pin) {
      setDraft({ ...commercial });
      setUnlocked(true);
      setPinError(false);
    } else setPinError(true);
  }

  function save() {
    if (!draft) return;
    if (!draft.pin.trim()) return;
    patch({ commercial: draft });
    setUnlocked(false);
    setPinInput('');
  }

  function onLogo(file?: File) {
    if (!file) return;
    if (file.size > 400_000) return;
    const reader = new FileReader();
    reader.onload = () => set('logoDataUrl', String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <>
      <SectionTitle eyebrow="Contacto y contratación" title="Hablemos de tu instalación" description="Toda la información de contacto se guarda en este dispositivo. No se envía a ningún servidor." />

      <Panel tone="paper">
        <div className="installer-card">
          <div className="installer-card__logo">
            {commercial.logoDataUrl ? <img src={commercial.logoDataUrl} alt="Logotipo del instalador" /> : <Icon name="sun" size={24} />}
          </div>
          <div style={{ flex: 1 }}>
            <h3>{commercial.businessName}</h3>
            <p>{commercial.installerName}</p>
          </div>
          <Badge tone="solar">Montaje</Badge>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontSize: '.85rem' }}>{commercial.services}</p>
          <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}><Icon name="home" size={14} /> {commercial.zones}</p>
        </div>
        <div className="commercial__actions" style={{ marginTop: '1rem' }}>
          <Button variant="dark" icon="phone" disabled={!phoneConfigured(commercial.phone)} onClick={() => window.open(telHref(commercial.phone), '_self')}>Llamar ahora</Button>
          <Button variant="dark" icon="whatsapp" disabled={!phoneConfigured(commercial.whatsapp)} onClick={() => window.open(whatsappHref(commercial.whatsapp), '_blank', 'noopener')}>WhatsApp</Button>
          <Button variant="dark" icon="share" onClick={() => {
            const text = `${commercial.businessName}. ${commercial.services} Contacto: ${commercial.phone}`;
            void navigator.clipboard?.writeText(text);
          }}>Compartir contacto</Button>
        </div>
        {!phoneConfigured(commercial.phone) && <Note level="warning">El número de teléfono sigue siendo el valor de ejemplo. Desbloquea la configuración y pon tu número real.</Note>}
      </Panel>

      <Panel tone="paper">
        <div className="panel__head"><h3>Configuración del instalador</h3><Icon name="lock" size={18} /></div>
        {!unlocked ? (
          <>
            <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Protegida con un PIN local sencillo (no es un sistema de usuarios).</p>
            <div className="row">
              <input type="password" inputMode="numeric" value={pinInput} placeholder="PIN" aria-label="PIN de configuración" onChange={(e) => { setPinInput(e.target.value); setPinError(false); }} style={{ maxWidth: '8rem' }} />
              <Button icon="lock" onClick={unlock}>Desbloquear</Button>
            </div>
            {pinError && <Note level="error">PIN incorrecto.</Note>}
          </>
        ) : (
          draft && (
            <>
              <TextField label="Nombre comercial" value={draft.businessName} onChange={(v) => set('businessName', v)} />
              <TextField label="Nombre del instalador" value={draft.installerName} onChange={(v) => set('installerName', v)} />
              <div className="selected-item__grid">
                <TextField label="Teléfono" value={draft.phone} onChange={(v) => set('phone', v)} placeholder="+535XXXXXXXX" />
                <TextField label="WhatsApp" value={draft.whatsapp} onChange={(v) => set('whatsapp', v)} placeholder="535XXXXXXXX" />
              </div>
              <TextField label="Servicios" value={draft.services} onChange={(v) => set('services', v)} multiline />
              <TextField label="Zonas de trabajo" value={draft.zones} onChange={(v) => set('zones', v)} />
              <TextField label="PIN local" value={draft.pin} onChange={(v) => set('pin', v)} hint="Cámbialo si quieres. Guárdalo: no se puede recuperar." />
              <div className="field">
                <span className="field__label">Fotografía o logotipo</span>
                <input type="file" accept="image/*" aria-label="Subir logotipo" onChange={(e) => onLogo(e.target.files?.[0])} />
                <span className="field__hint">Imagen pequeña (máx. 400 kB). Se guarda en este dispositivo.</span>
              </div>
              <div className="wizard-actions">
                <Button variant="quiet" onClick={() => setUnlocked(false)}>Cancelar</Button>
                <Button icon="check" onClick={save}>Guardar cambios</Button>
              </div>
            </>
          )
        )}
      </Panel>

      <Note level="info" title="Sin datos personales">
        La calculadora no pide nombre, correo ni registro. La información de contacto la escribe el instalador una sola vez en este dispositivo.
      </Note>
    </>
  );
}
