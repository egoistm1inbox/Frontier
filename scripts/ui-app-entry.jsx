/**
 * Bundle entry for UI verification: re-exports the app together with the React
 * internals the runner needs, so the runner and the bundle share one React.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';

export { React, act, createRoot, App };
