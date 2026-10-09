import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dm-sans/300.css';
import '@fontsource/dm-sans/400.css';
import './styles/Editor.css';
import './styles/Landscape.css';
import { App } from './App.jsx';

createRoot(document.getElementById('Editor')).render(<App />);
