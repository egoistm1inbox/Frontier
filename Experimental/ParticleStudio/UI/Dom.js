// Particle Studio UI · tiny element factory used by every component in UI/.
import { ConstructGlyph } from './Glyphs.js';

// h('button', { class: 'ps-round', type: 'button', title: '…', onclick: Fn }, Child, 'text', …)
export function h(Tag, Props, ...Kids)
{
    const El = document.createElement(Tag);
    for (const [Key, Value] of Object.entries(Props || {}))
    {
        if (Value === null || Value === undefined || Value === false) continue;
        if (Key === 'class') El.className = Value;
        else if (Key === 'text') El.textContent = String(Value);
        else if (Key === 'style' && typeof Value === 'object') Object.assign(El.style, Value);
        else if (Key.startsWith('on') && typeof Value === 'function') El.addEventListener(Key.slice(2), Value);
        else El.setAttribute(Key, Value === true ? '' : String(Value));
    }
    Append(El, Kids);
    return El;
}

function Append(El, Kids)
{
    for (const Kid of Kids)
    {
        if (Kid === null || Kid === undefined || Kid === false) continue;
        if (Array.isArray(Kid)) Append(El, Kid);
        else El.append(Kid instanceof Node ? Kid : document.createTextNode(String(Kid)));
    }
}

export const Icon = (Name, ClassName = 'glyph') => ConstructGlyph(Name, ClassName);

export function SetIcon(El, Name)
{
    if (!El) return;
    El.textContent = '';
    El.append(Icon(Name));
}

// Availability contract shared with the editor bindings: { Enabled, Reason }.
export const Availability = Binding => (Binding && Binding.Availability ? Binding.Availability() : null) || { Enabled: true };
