import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './app/AppContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Alcance explícito derivado de la URL del documento: funciona igual
    // servido desde la raíz que desde un subdirectorio.
    const scriptUrl = new URL('sw.js', document.baseURI);
    const scopeUrl = new URL('./', document.baseURI);
    navigator.serviceWorker
      .register(scriptUrl, { scope: scopeUrl.pathname })
      .catch(() => {
        // Sin service worker la aplicación sigue funcionando con conexión.
      });
  });
}
