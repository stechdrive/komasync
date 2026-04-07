import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const unregisterCoiServiceWorker = () => {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  const reloadKey = 'coi-sw-unregister-reload';
  const currentControllerUrl = navigator.serviceWorker.controller?.scriptURL ?? '';
  const shouldReload = () => sessionStorage.getItem(reloadKey) !== '1';
  const triggerReload = () => {
    sessionStorage.setItem(reloadKey, '1');
    window.location.reload();
  };

  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    const targets = registrations.filter((registration) => {
      const scriptUrl =
        registration.active?.scriptURL ??
        registration.waiting?.scriptURL ??
        registration.installing?.scriptURL ??
        '';
      return scriptUrl.includes('coi-serviceworker.js') && registration.scope.startsWith(baseUrl.origin);
    });

    if (targets.length === 0) return;

    void Promise.all(targets.map((registration) => registration.unregister())).then((results) => {
      if (!results.some(Boolean)) return;
      if (currentControllerUrl.includes('coi-serviceworker.js') && shouldReload()) {
        triggerReload();
      }
    });
  }).catch(() => undefined);
};

unregisterCoiServiceWorker();

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
