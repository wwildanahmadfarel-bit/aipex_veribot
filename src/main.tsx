import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { prepareVoices } from './lib/speech';

// Muat daftar suara lebih awal agar auto-baca hasil OCR tidak menunggu
// voiceschanged pada pemindaian pertama.
prepareVoices();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
