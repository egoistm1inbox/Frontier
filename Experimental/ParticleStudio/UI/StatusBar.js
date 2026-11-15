// Particle Studio UI · status strip (written from scratch). The single footer of the studio, at the outliner foot:
// Effects, Forces, Readback on one line of label-over-value cells, and the graphics adapter underneath.
import { h } from './Dom.js';

export function CreateStatusBar(Host)
{
    const Cell = (Label, Id, Wide) => h('div', { class: 'ps-status-cell' + (Wide ? ' wide' : '') }, h('span', null, Label), h('b', { id: Id }, '—'));
    Host.append(h('div', { class: 'ps-status' },
        Cell('Effects', 'status-effects'),
        Cell('Forces', 'status-forces'),
        Cell('Readback', 'status-readback'),
        Cell('Adapter', 'status-adapter', true)));
    return {
        Set(Id, Text)
        {
            const El = document.getElementById(Id);
            if (El && El.textContent !== Text) { El.textContent = Text; El.title = Text; }
        }
    };
}
