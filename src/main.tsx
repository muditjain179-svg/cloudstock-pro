import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      // Check for updates every 60 seconds
      setInterval(() => {
        registration.update();
      }, 60000);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New worker is ready and there's an existing one - send skip waiting
              newWorker.postMessage('SKIP_WAITING');
            }
          });
        }
      });
    }).catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });

  // When the new worker takes over, reload the page to get the latest content
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
