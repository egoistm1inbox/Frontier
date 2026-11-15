// Particle Studio UI · glyph library (SVG path data + rich isometric icons). Pure data + one factory; no DOM state.
const SvgNamespace = 'http://www.w3.org/2000/svg';

export const GlyphPaths = {
    Monitor:    '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17v4"/>',
    Zap:        '<path d="M13 2.5 4.5 14h6.5l-1 7.5L18.5 10H12z"/>',
    Sparkles:   '<path d="M11 3.5l1.7 4.6 4.6 1.7-4.6 1.7L11 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z"/><path d="M18.5 14.5v5M16 17h5"/>',
    Aperture:   '<circle cx="12" cy="12" r="9"/><path d="M14.3 3.3 9.5 11.5M20.7 9.6H11.2M18.4 18.3l-4.8-8.2M9.7 20.7l4.8-8.2M3.3 14.4h9.5M5.6 5.7l4.8 8.2"/>',
    Sun:        '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    Layers:     '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    Scan:       '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M7.5 12h9"/>',
    Gauge:      '<path d="M3.6 17.5a9 9 0 1 1 16.8 0"/><path d="M12 13.5l4.2-4.2"/><circle cx="12" cy="13.5" r="1.2"/>',
    Boxes:      '<path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2z"/><path d="M12 12l8-4.6M12 12v9.2M12 12 4 7.4"/>',
    Lattice:    '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    Bug:        '<rect x="7.5" y="7" width="9" height="13" rx="4.5"/><path d="M12 7V4.5M9.5 4l1.3 1.6M14.5 4l-1.3 1.6M7.5 12H3.5M20.5 12h-4M7.8 16.5 4.5 19M16.2 16.5l3.3 2.5M7.8 8.8 4.8 6.5M16.2 8.8l3-2.3"/>',
    Activity:   '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    Chevron:    '<path d="M6 9l6 6 6-6"/>',
    Check:      '<path d="M5 12.5l4.2 4.2L19 7"/>',
    Alert:      '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.4v.2"/>',
    Eye:        '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    EyeOff:     '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.5M6.2 6.3C3.6 8.1 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/>',
    Search:     '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/>',
    Sliders:    '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    Cloud:      '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5z"/>',
    Snowflake:  '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8M9.5 4.6 12 7l2.5-2.4M9.5 19.4 12 17l2.5 2.4M5 10.1l2.8-1.4-.4-3.1M19 13.9l-2.8 1.4.4 3.1M19 10.1l-2.8-1.4.4-3.1M5 13.9l2.8 1.4-.4 3.1"/>',
    CloudRain:  '<path d="M6.5 15.5h11a3.8 3.8 0 0 0 .5-7.55A5.5 5.5 0 0 0 7 6.8a4.2 4.2 0 0 0-.5 8.7z"/><path d="M8.5 18l-1.3 3.2M12.5 18l-1.3 3.2M16.5 18l-1.3 3.2"/>',
    CloudHail:  '<path d="M6.5 15h11a3.8 3.8 0 0 0 .5-7.55A5.5 5.5 0 0 0 7 6.3a4.2 4.2 0 0 0-.5 8.7z"/><circle cx="8.5" cy="18.5" r="1.25"/><circle cx="12.5" cy="20.5" r="1.25"/><circle cx="16.5" cy="18.5" r="1.25"/>',
    Planet:     '<circle cx="12" cy="12" r="5.2"/><path d="M5.3 15.9C3.1 18 2.6 19.6 3.6 20.3c1.7 1.2 7.2-1.2 12.2-5.4 4.6-3.9 6.8-7.9 5-8.9-.9-.5-2.4-.1-4.3.9"/>',
    Wind:       '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h15.5a3 3 0 1 1-3 3M3 16.5h7"/>',
    Copy:       '<rect x="9" y="9" width="11.5" height="11.5" rx="2.5"/><path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5"/>',
    Reset:      '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4.6h4.6"/>',
    Plus:       '<path d="M12 5v14M5 12h14"/>',
    Close:      '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    Rays:       '<circle cx="5" cy="19" r="1.6"/><path d="M6.3 17.7 20 4M6.6 18.3l13.9-6.8M5.7 17.4l6.8-13.9"/>',
    Clock:      '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    Target:     '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6"/>',
    Folder:     '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    Dot:        '<circle cx="12" cy="12" r="3"/>',
    Tornado:    '<path d="M3 5h18M5.5 9h13M8 13h8.5M10 17h5M11.5 21h2"/>',
    Attract:    '<circle cx="12" cy="12" r="2.2"/><path d="M3 12h5M16 12h5M12 3v5M12 16v5M6 10l2 2-2 2M18 10l-2 2 2 2M10 6l2 2 2-2M10 18l2-2 2 2"/>',
    Repel:      '<circle cx="12" cy="12" r="2.2"/><path d="M2.5 12h5M16.5 12h5M12 2.5v5M12 16.5v5M4.5 10l-2 2 2 2M19.5 10l2 2-2 2M10 4.5l2-2 2 2M10 19.5l2 2 2-2"/>',
    Orbit:      '<circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="9.5" ry="4.4" transform="rotate(-24 12 12)"/>',
    Magnet:     '<path d="M5 3.5h4.5v8a2.5 2.5 0 0 0 5 0v-8H19v8a7 7 0 0 1-14 0z"/><path d="M5 7.5h4.5M14.5 7.5H19"/>',
    Thermal:    '<path d="M8 20V8M5 11l3-3 3 3M16 20V4.5M13 7.5l3-3 3 3"/>',
    Front:      '<path d="M14.5 3c-3 3-3 15 0 18"/><path d="M3 8h7.5M3 12h8M3 16h7.5"/><path d="M18 9l2.5 3-2.5 3"/>',
    Blast:      '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="5.6" stroke-dasharray="2 2.6"/><circle cx="12" cy="12" r="9.2"/>',
    Current:    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M6.5 10h9.5l-2-2M6.5 14h9.5l-2 2"/>',
    Lift:       '<path d="M12 18.5V5M8 9l4-4 4 4"/><path d="M5 20.5h14"/>',
    Gravity:    '<path d="M12 3.5V17M8 13l4 4 4-4"/><path d="M5 20.5h14"/>',
    Damp:       '<path d="M2.5 9c1.6-3.6 3.2-3.6 4.8 0s3.2 2.6 4.8 0 3-1.8 4.6 0 2.4 1.2 4.8 0"/><path d="M2.5 15.5h19"/>',
    Play:       '<path d="M8 5.5v13l10.5-6.5z"/>',
    Pause:      '<path d="M8.5 5v14M15.5 5v14"/>',
    Step:       '<path d="M7 6v12l8-6z"/><path d="M17.5 6v12"/>',
    Library:    '<path d="M4 4.5h4v15H4zM10 4.5h4v15h-4z"/><path d="M15.8 5.8l3.4-.9 3.3 13.6-3.4.9z"/>',
    Trash:      '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    Crosshair:  '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
    Map:        '<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    Compass:    '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    Leaf:       '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l8-8"/>',
    Atom:       '<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)"/>',
    Flame:      '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4.5-4-6.5-4.5-11-3 2-5 4.5-5 7.5-1.2-.7-1.8-2-2-3.5-1.5 1.8-1.5 4.5-1.5 7A6.5 6.5 0 0 0 12 21z"/>',
    Drop:       '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3z"/>',
    Move:       '<path d="M12 3v18M3 12h18M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5"/>',
    Palette:    '<path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2 0-1.4-1.2-1.6-1.2-2.8 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7" r="1.1"/><circle cx="14.5" cy="7" r="1.1"/>',
    Download:   '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    Help:       '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17.5h.01"/>',
    Focus:      '<path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4"/><circle cx="12" cy="12" r="2.2"/>',
    Maximize:   '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    Terminal:   '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 9.5 11 12l-3.5 2.5M13 14.5h3.5"/>',
    Grid:       '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    Compact:    '<path d="M7 5v14M17 5v14"/>',
    Field:      '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
    FlowLine:   '<path d="M3 16c4-8 8 4 12-4 2-4 4-4 6-4"/><circle cx="19" cy="8" r="1.8"/>',
    Jet:        '<path d="M4 12h15"/><path d="m14 7 5 5-5 5"/><path d="M4 7h6M4 17h6"/>',
    Downburst:  '<path d="M12 3v13"/><path d="M6 19c2-2 4-3 6-3s4 1 6 3"/><path d="m8 11 4 4 4-4"/>',
    Puff:       '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
    Wake:       '<path d="M4 12h16"/><path d="M4 12c4-4 10-6 16-6"/><path d="M4 12c4 4 10 6 16 6"/>',
    Ruler:      '<path d="M4 15h16M4 15v-4m4 4v-2m4 2v-3m4 3v-2m4 2v-4"/>',
    Camera:     '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2l1.4-2h4.2l1.4 2h2A2.5 2.5 0 0 1 20 7.5v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.4"/>',
    Lock:       '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    Heat:       '<path d="M7 19c1.5-2.5-1.5-4.5 0-7s-1.5-4.5 0-7M12 19c1.5-2.5-1.5-4.5 0-7s-1.5-4.5 0-7M17 19c1.5-2.5-1.5-4.5 0-7s-1.5-4.5 0-7"/>',
    Singularity:'<circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="9.5" ry="3.4" transform="rotate(-18 12 12)"/><circle cx="12" cy="12" r="6.8" stroke-dasharray="2.5 3"/>',
    Car:        '<path d="M5 15.5h14l1.2-3.3-2.6-1.2-2.4-3.5H8.8L6.4 11l-2.6 1.2z"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/><path d="M9.5 16.5h5"/>',
    Ball:       '<circle cx="12" cy="12" r="8"/><path d="M5.5 8.5c4 2.5 9 2.5 13 0M12 4a11 11 0 0 1 0 16"/>',
    Cloth:      '<path d="M5 3v18"/><path d="M5 4.5c4-1.5 7 1.5 13 0v8c-6 1.5-9-1.5-13 0"/>'
};

let RichUid = 0;

export const RichGlyphs = {
    Camera: (P) => `<defs>` +
        `<linearGradient id="${P}cb" x2=".1" y2="1"><stop stop-color="#55555e"/><stop offset=".35" stop-color="#34353c"/><stop offset="1" stop-color="#202126"/></linearGradient>` +
        `<linearGradient id="${P}ce" x2="0" y2="1"><stop stop-color="#9696a3" stop-opacity=".55"/><stop offset=".5" stop-color="#62626b" stop-opacity=".15"/><stop offset="1" stop-color="#08090c" stop-opacity=".8"/></linearGradient>` +
        `<linearGradient id="${P}cr" x2=".25" y2="1"><stop stop-color="#25262e"/><stop offset=".55" stop-color="#36373f"/><stop offset="1" stop-color="#676773"/></linearGradient>` +
        `<radialGradient id="${P}cg" cx="46%" cy="38%" r="65%"><stop stop-color="#272933"/><stop offset=".45" stop-color="#101118"/><stop offset=".73" stop-color="#0b0d12"/><stop offset=".9" stop-color="#232530"/><stop offset="1" stop-color="#080a0e"/></radialGradient>` +
        `<linearGradient id="${P}cs" x2=".15" y2="1"><stop stop-color="#eff0f7" stop-opacity=".85"/><stop offset=".38" stop-color="#a0a4b6" stop-opacity=".54"/><stop offset="1" stop-color="#767b97" stop-opacity="0"/></linearGradient>` +
        `<linearGradient id="${P}cf" x2="0" y2="1"><stop stop-color="#eeeef6"/><stop offset=".55" stop-color="#8e91a2"/><stop offset="1" stop-color="#373945"/></linearGradient>` +
        `</defs>` +
        `<rect x="28" y="55" width="200" height="154" rx="23" fill="url(#${P}cb)" stroke="url(#${P}ce)" stroke-width="2.4"/>` +
        `<path d="M43 60q5-3 14-3h145q12 0 19 10" stroke="#b6b6c4" stroke-opacity=".18" stroke-width="1.4" fill="none"/>` +
        `<circle cx="128" cy="134" r="60" fill="url(#${P}cr)" stroke="#92929e" stroke-opacity=".35" stroke-width="1.4"/>` +
        `<circle cx="128" cy="134" r="44" fill="#101117" stroke="#777783" stroke-opacity=".45" stroke-width="1.6"/>` +
        `<circle cx="128" cy="134" r="40.5" fill="url(#${P}cg)" stroke="#353641" stroke-width="1.2"/>` +
        `<circle cx="128" cy="134" r="35.5" stroke="#646375" stroke-opacity=".18" stroke-width="1.2" fill="none"/>` +
        `<path d="M104 114c1-17 45-21 48-2 1 7-7 13-24 13-14 0-25-4-24-11Z" fill="url(#${P}cs)"/>` +
        `<path d="M104 162q24 15 47-3" stroke="#7c7496" stroke-opacity=".26" stroke-width="2" fill="none"/>` +
        `<circle cx="128" cy="133" r="3.2" fill="#d7dbe5" opacity=".75"/>` +
        `<rect x="184" y="71" width="22" height="17" rx="3" fill="#17181e" stroke="#767780" stroke-opacity=".4"/>` +
        `<rect x="188" y="74" width="14" height="10" rx="1.8" fill="url(#${P}cf)"/>`,

    Exposure: (P) => `<defs>` +
        `<linearGradient id="${P}er" x2=".8" y2="1"><stop stop-color="#d4dce0"/><stop offset=".45" stop-color="#778594"/><stop offset="1" stop-color="#3b485b"/></linearGradient>` +
        `<linearGradient id="${P}el" x2=".8" y2="1"><stop stop-color="#fffbed"/><stop offset="1" stop-color="#c8c9bd"/></linearGradient>` +
        `<linearGradient id="${P}ed" x2=".8" y2="1"><stop stop-color="#586372"/><stop offset="1" stop-color="#1a2638"/></linearGradient>` +
        `</defs>` +
        `<circle cx="128" cy="130" r="78" fill="url(#${P}er)"/>` +
        `<circle cx="128" cy="130" r="68" fill="url(#${P}ed)"/>` +
        `<path d="M128 62a68 68 0 0 1 0 136Z" fill="url(#${P}el)"/>` +
        `<circle cx="128" cy="130" r="68" stroke="#e4eef2" stroke-opacity=".3" fill="none" stroke-width="2"/>` +
        `<path d="M96 114v32m-16-16h32" stroke="#e5e8e5" stroke-width="7" stroke-linecap="round" fill="none"/>` +
        `<path d="M146 130h30" stroke="#4b5664" stroke-width="7" stroke-linecap="round" fill="none"/>` +
        `<path d="M68 66a88 88 0 0 1 120 0" stroke="#b8c9d8" stroke-width="3.5" fill="none" stroke-linecap="round"/>` +
        `<path d="M128 28v10m-42 3 5 9m74-9-5 9" stroke="#dce6ee" stroke-width="4.5" stroke-linecap="round" fill="none"/>`,

    HeatLens: (P) => `<defs>` +
        `<linearGradient id="${P}hr" x2=".8" y2="1"><stop stop-color="#f3c184"/><stop offset=".5" stop-color="#b86b3a"/><stop offset="1" stop-color="#4e2618"/></linearGradient>` +
        `<radialGradient id="${P}hg" cx="50%" cy="55%" r="60%"><stop stop-color="#4e2418"/><stop offset=".6" stop-color="#1b141a"/><stop offset="1" stop-color="#0b0d12"/></radialGradient>` +
        `</defs>` +
        `<circle cx="128" cy="128" r="80" fill="url(#${P}hr)"/>` +
        `<circle cx="128" cy="128" r="66" fill="url(#${P}hg)" stroke="#ffd6a8" stroke-opacity=".28" stroke-width="2"/>` +
        `<path d="M90 176c14-20-12-38 2-58s-12-38 2-58M128 176c14-20-12-38 2-58s-12-38 2-58M166 176c14-20-12-38 2-58s-12-38 2-58" stroke="#ffb36b" stroke-width="7" stroke-linecap="round" fill="none"/>`,

    BlackHoleLens: (P) => `<defs>` +
        `<linearGradient id="${P}br" x2=".8" y2="1"><stop stop-color="#d2b48c"/><stop offset=".45" stop-color="#7c6c84"/><stop offset="1" stop-color="#222536"/></linearGradient>` +
        `<radialGradient id="${P}bh" cx="50%" cy="50%" r="55%"><stop stop-color="#040507"/><stop offset=".62" stop-color="#07090d"/><stop offset=".85" stop-color="#f5b855"/><stop offset="1" stop-color="#1a1d28"/></radialGradient>` +
        `</defs>` +
        `<circle cx="128" cy="128" r="80" fill="url(#${P}br)"/>` +
        `<circle cx="128" cy="128" r="68" fill="url(#${P}bh)"/>` +
        `<ellipse cx="128" cy="128" rx="86" ry="28" transform="rotate(-20 128 128)" stroke="#f6c26b" stroke-width="5.5" fill="none" opacity=".88"/>` +
        `<circle cx="128" cy="128" r="34" fill="#040508" stroke="#ffe1a8" stroke-opacity=".65" stroke-width="2.5"/>`,

    GlitchLens: (P) => `<defs>` +
        `<linearGradient id="${P}gr" x2=".8" y2="1"><stop stop-color="#9aa4b4"/><stop offset=".5" stop-color="#454d5b"/><stop offset="1" stop-color="#191d25"/></linearGradient>` +
        `</defs>` +
        `<rect x="38" y="46" width="180" height="164" rx="22" fill="url(#${P}gr)" stroke="#a6b3c4" stroke-opacity=".35" stroke-width="2.4"/>` +
        `<rect x="54" y="62" width="148" height="132" rx="14" fill="#101319"/>` +
        `<rect x="66" y="84" width="108" height="14" rx="3" fill="#00ffd0" opacity=".85"/>` +
        `<rect x="84" y="108" width="106" height="14" rx="3" fill="#ff2d6f" opacity=".85"/>` +
        `<rect x="60" y="132" width="96" height="14" rx="3" fill="#e6edf6" opacity=".85"/>` +
        `<rect x="78" y="156" width="112" height="12" rx="3" fill="#7aa8e8" opacity=".8"/>`
};

export function ConstructGlyph(Name, ClassName = 'glyph')
{
    const Svg = document.createElementNS(SvgNamespace, 'svg');
    if (RichGlyphs[Name])
    {
        Svg.setAttribute('viewBox', '0 0 256 256');
        Svg.setAttribute('class', `${ClassName} rich-icon`);
        Svg.setAttribute('fill', 'none');
        Svg.setAttribute('aria-hidden', 'true');
        Svg.innerHTML = RichGlyphs[Name](`ri${++RichUid}_`);
        return Svg;
    }
    Svg.setAttribute('viewBox', '0 0 24 24');
    Svg.setAttribute('class', ClassName);
    Svg.innerHTML = GlyphPaths[Name] || GlyphPaths.Dot;
    return Svg;
}
