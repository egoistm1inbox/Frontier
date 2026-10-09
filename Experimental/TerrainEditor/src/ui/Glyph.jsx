// Glyphs in the Frontier editor style: 24-unit grid, 1.5 stroke, round caps.
import React from "react";

const Paths = {
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  eye: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>),
  check: <path d="m5 12 4 4L19 6" />,
  warning: (<><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4M12 17.2v.1" /></>),
  up: <path d="m7 14 5-5 5 5" />,
  down: <path d="m7 10 5 5 5-5" />,
  duplicate: (<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  export: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  preset: <path d="M4 6h16M4 12h10M4 18h7" />,
  layers: (<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5M3 17.5l9 5 9-5" /></>),
  mountain: <path d="M2 19 9 7l4 6 3-4 6 10H2Z" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4M16 15v4" />,
  rock: <path d="M4 17 7 9l5-3 5 2 3 9H4Z" />,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />,
  wave: <path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />,
  cube: (<><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>),
  palette: (<><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.9 17 3 12 3Z" /><circle cx="7.5" cy="10.5" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="16.5" cy="10.5" r="1" /></>),
  mask: (<><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></>),
  river: <path d="M6 3c0 4 6 5 6 9s-6 5-6 9M14 3c0 3-3 4-3 7" />,
  lake: <ellipse cx="12" cy="12" rx="9" ry="6" />,
  sea: (<><path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M12 4v6" /></>),
  generator: (<><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4" /></>),
  surface: <path d="M3 17 9 11l4 4 8-8" />,
  erosion: <path d="M3 18h4l3-6 3 4 3-8 5 10" />,
  voxel: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  texture: (<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></>),
  heightfield: <path d="M3 17c3-6 6-8 9-8s6 2 9 8" />,
  flow: <path d="M4 6c4 0 4 12 16 12M4 12h10M4 18h4" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
};

export default function Glyph({ Name, Size = 18 }) {
  return (
    <svg width={Size} height={Size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Paths[Name] || Paths.layers}
    </svg>
  );
}

// Glyph name for each operation group, so rows and tiles share one icon language.
export function GroupGlyph(Group) {
  return {
    Generators: "generator", Modify: "sliders", Surface: "rock", Erosion: "erosion",
    Water: "wave", Voxel: "voxel", Texturing: "palette", Masks: "mask", Heightfield: "heightfield",
  }[Group] || "layers";
}
