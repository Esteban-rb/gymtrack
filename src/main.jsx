import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import './styles.css';
import App from './App.jsx';
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
setInterval(() => { document.title = 'GT:' + (window.__gt_trace || 'no-trace'); }, 400);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
