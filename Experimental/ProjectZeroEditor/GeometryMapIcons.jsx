//============================================================================================================================================
//                                                           GEOMETRYMAPICONS.JSX
//============================================================================================================================================
// 🧩 One drawn icon per geometry map (Follow-up 75), for the Baking tab's LayerStack, its Map page and Texture paint's Mask page, plus
// the distance field the Baking tab also holds. Each icon pictures what its map measures: occlusion as a shadowed corner, curvature as
// a bent line with its tangent, cavity as a pit, convexity as a bump, edge wear as a chipped edge, dirt as specks gathered in a crease,
// dust as specks settling from above, thickness as a wall's two faces, the bevel mask as a rounded corner, world normal as arrows off a
// surface, position as axes, UV islands as packed tiles, the UV wireframe as a triangulated square, the distance field as rings.
// Each takes the map's group tone (CSS: .gm-icon[data-group]).

import React from "react";

const Shapes = {
  occlusion: (
    <>
      <path d="M4 20V5h15" />
      <path d="M4 20h16" opacity="0.5" />
      <path d="M4 5c5 0 8 2.5 9 6M4 9c3 .4 5 2 5.6 4.5M4 13c1.6.3 2.6 1.2 3 2.5" opacity="0.75" />
    </>
  ),
  curvature: (
    <>
      <path d="M3.5 17c3-8 14-8 17 0" />
      <path d="M6 8.5h12" opacity="0.55" />
      <circle cx="12" cy="11" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  cavity: (
    <>
      <path d="M3 9h5c1 0 1.5 1 2 3 .6 2.5 1.2 4 2 4s1.4-1.5 2-4c.5-2 1-3 2-3h5" />
      <path d="M10.5 14.5c.5 1 1 1.5 1.5 1.5s1-.5 1.5-1.5" opacity="0.5" strokeWidth="2.6" />
    </>
  ),
  convexity: (
    <>
      <path d="M3 16h4c1 0 1.5-1 2-3 .6-2.5 1.5-5 3-5s2.4 2.5 3 5c.5 2 1 3 2 3h4" />
      <path d="M10.4 9.5c.5-.9 1-1.5 1.6-1.5s1.1.6 1.6 1.5" opacity="0.5" strokeWidth="2.6" />
    </>
  ),
  "edge-wear": (
    <>
      <path d="M4 20V8l4-4h12v16z" opacity="0.55" />
      <path d="M4 8l4-4M4 11.5l1.4-.8.6 1.6L8 7.4l1.3.6L12 4" />
    </>
  ),
  dirt: (
    <>
      <path d="M3 6l9 12 9-12" />
      <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="13" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="12.6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.6" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  dust: (
    <>
      <path d="M3 19h18" />
      <path d="M5 16.5h14" opacity="0.5" strokeWidth="2.4" />
      <circle cx="7" cy="5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="4.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="11.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  thickness: (
    <>
      <path d="M6 4v16M18 4v16" />
      <path d="M8.5 12h7M8.5 12l2-2M8.5 12l2 2M15.5 12l-2-2M15.5 12l-2 2" opacity="0.75" />
    </>
  ),
  "bevel-mask": (
    <>
      <path d="M4 20V11a7 7 0 0 1 7-7h9" />
      <path d="M7.6 20v-9a3.4 3.4 0 0 1 3.4-3.4H20" opacity="0.45" />
    </>
  ),
  "world-normal": (
    <>
      <path d="M3 18c4-3 14-3 18 0" />
      <path d="M7 15.6 5.5 7.5M12 14.8V5M17 15.6l1.5-8.1" opacity="0.8" />
      <path d="M10.4 6.6 12 5l1.6 1.6" />
    </>
  ),
  position: (
    <>
      <path d="M5 19V5M5 19h14M5 19l8-6" />
      <path d="M3.6 6.6 5 5l1.4 1.6M17.4 17.6 19 19l-1.6 1.4" />
    </>
  ),
  "uv-island": (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" opacity="0.45" />
      <path d="M6 6h6v5H6zM14 6h4v8h-4zM6 13.5h6V18H6z" />
    </>
  ),
  wireframe: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 20 20 4M4 12l8-8M12 20l8-8" opacity="0.6" />
    </>
  ),
  "distance-field": (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="6" opacity="0.6" />
      <circle cx="12" cy="12" r="9" opacity="0.3" />
    </>
  ),
};
// Group tones (TextureStudio MESH_MAPS groups): occlusion and wear masks, surface direction, reference maps, the distance field.
const Groups = {
  occlusion: "light",
  thickness: "light",
  curvature: "shape",
  cavity: "shape",
  convexity: "shape",
  "bevel-mask": "shape",
  "edge-wear": "wear",
  dirt: "wear",
  dust: "wear",
  "world-normal": "space",
  position: "space",
  "uv-island": "layout",
  wireframe: "layout",
  "distance-field": "field",
};

export const GeometryMapGroup = (Name) => Groups[Name] || "shape";
export default function GeometryMapIcon({ Name, Size = 16, Title }) {
  return (
    <span className="gm-icon" data-group={GeometryMapGroup(Name)} title={Title}>
      <svg viewBox="0 0 24 24" width={Size} height={Size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {Shapes[Name] || Shapes.curvature}
      </svg>
    </span>
  );
}
