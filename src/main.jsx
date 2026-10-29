import './lib/authLink.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are self-hosted (no request to Google): Inter for text, Noto Sans Georgian for Georgian script, Instrument Serif italic for
// the emphasised word in big headlines. Only the language ranges actually used are downloaded.
import '@fontsource-variable/inter/wght.css';
import '@fontsource/noto-sans-georgian/latin-400.css';
import '@fontsource/noto-sans-georgian/latin-ext-400.css';
import '@fontsource/noto-sans-georgian/georgian-400.css';
import '@fontsource/noto-sans-georgian/latin-600.css';
import '@fontsource/noto-sans-georgian/latin-ext-600.css';
import '@fontsource/noto-sans-georgian/georgian-600.css';
import '@fontsource/noto-sans-georgian/latin-700.css';
import '@fontsource/noto-sans-georgian/latin-ext-700.css';
import '@fontsource/noto-sans-georgian/georgian-700.css';
import '@fontsource/noto-sans-georgian/latin-800.css';
import '@fontsource/noto-sans-georgian/latin-ext-800.css';
import '@fontsource/noto-sans-georgian/georgian-800.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './styles/app.css';
import './styles/motion.css';
import './styles/landing.css';
import './styles/editorial.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
