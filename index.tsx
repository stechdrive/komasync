import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const registerCoiServiceWorker = () => {
  if (!import.meta.env.PROD) return;
  if (window.crossOriginIsolated) return;
  if (!('serviceWorker' in navigator)) return;

  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  const swUrl = new URL('coi-serviceworker.js', baseUrl).toString();
  const scope = baseUrl.pathname;
  const reloadKey = 'coi-sw-reload';

  const shouldReload = () => sessionStorage.getItem(reloadKey) !== '1';
  const triggerReload = () => {
    sessionStorage.setItem(reloadKey, '1');
    window.location.reload();
  };

  navigator.serviceWorker
    .register(swUrl, { scope, updateViaCache: 'none' })
    .then((registration) => {
      void registration.update();
      return navigator.serviceWorker.ready;
    })
    .then(() => {
      if (!window.crossOriginIsolated && shouldReload()) {
        triggerReload();
      }
    })
    .catch(() => undefined);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!shouldReload()) return;
    triggerReload();
  });
};

registerCoiServiceWorker();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
