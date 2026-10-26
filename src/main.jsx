import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-600.css';
import './styles.css';
import App from './App.jsx';
import { I18nProvider, detectLocale } from './i18n.js';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

// surface fatal init errors instead of a silent black screen
const fatal = (msg) => {
  const el = document.createElement('pre');
  el.id = 'gt-fatal';
  el.style.cssText = 'position:fixed;inset:auto 8px 8px 8px;z-index:99;color:#FF3B30;font-size:11px;white-space:pre-wrap;';
  el.textContent = String(msg);
  document.body.appendChild(el);
};
window.addEventListener('error', (e) => fatal(e.message + '\n' + (e.error?.stack || '')));
window.addEventListener('unhandledrejection', (e) => fatal('rejection: ' + (e.reason?.stack || e.reason)));

const mount = () => ReactDOM.createRoot(document.getElementById('root')).render(<I18nProvider locale={detectLocale()}><App /></I18nProvider>);
if (import.meta.env.DEV) {
  // dev only: ?db=demo fills a throw-away database with finished cycles before the app starts
  import('./dev-demo.js').then((m) => m.maybeSeedDemo()).catch((e) => fatal('demo seed failed: ' + (e.stack || e))).finally(mount);
} else {
  mount();
}
