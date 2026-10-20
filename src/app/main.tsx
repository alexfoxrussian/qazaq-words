import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-600.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/noto-sans/cyrillic-400.css';
import '@fontsource/noto-sans/cyrillic-600.css';
import '@fontsource/noto-sans/cyrillic-700.css';
import '@fontsource/noto-sans/cyrillic-ext-400.css';
import '@fontsource/noto-sans/cyrillic-ext-600.css';
import '@fontsource/noto-sans/cyrillic-ext-700.css';
import '../styles/tokens.css';
import '../styles/global.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
