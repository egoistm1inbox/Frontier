// Particle Studio UI · mounts the four docked components into the empty hosts in index.html. Imported first by
// ParticleEditor.js, so every element id the editor binds to exists before the editor's own module code runs.
import { CreateOutliner } from './Outliner.js';
import { CreateHeader } from './Header.js';
import { CreateInspector } from './Inspector.js';
import { CreateStatusBar } from './StatusBar.js';

const Need = Selector =>
{
    const El = document.querySelector(Selector);
    if (!El) throw new Error(`Particle Studio shell: missing host ${Selector}`);
    return El;
};

const Outliner = CreateOutliner(Need('[data-ui="outliner"]'));
const Header = CreateHeader(Need('[data-ui="header"]'));
const Inspector = CreateInspector(Need('[data-ui="inspector"]'));
const Status = CreateStatusBar(Outliner.StatusHost);

export const UI = { Outliner, Header, Inspector, Status };
