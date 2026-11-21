//============================================================================================================================================
//                                                          OBJECTCOMPONENTS.JSX
//============================================================================================================================================
// 🧩 Object components: Mass, Rigid Body and Collision hang under each showcase object in the outliner, the way the post effects hang
// under Post Process. They are outliner rows with their own inspectors, but their values live on the owning object (Values[Owner]),
// so the object's viewport, checks and quick controls keep reading the same keys. Browser authoring only.

import React from "react";
import "./ObjectComponents.css";
import { ShapeOf, Measure, MassOf, CollisionProxy } from "./PrimitiveInspector.jsx";

export const ComponentPanel = "object-component";
export const ComponentSheet = [];

// Component, baked icon, description.
export const ObjectComponentTypes = [
  ["Mass", "editor-mass", "Density, mass and spin resistance"],
  ["Rigid Body", "editor-physics", "Simulation and surface response"],
  ["Collision", "editor-box-collider", "Collision shape and filtering"],
];

const Slug = (Component) => Component.toLowerCase().replace(/\s+/g, "-");
export const IsObjectOwner = (Row) => Row?.Panel === "geometry" && Row.Parent === "showcase";

export function ComponentRow(OwnerId, Component) {
  const [, Icon, Description] = ObjectComponentTypes.find(([Name]) => Name === Component) || ObjectComponentTypes[0];
  return { Id: `${OwnerId}-${Slug(Component)}`, Name: Component, Panel: ComponentPanel, Icon, Parent: OwnerId, Description, Component };
}
export const ComponentRowsFor = (OwnerId) => ObjectComponentTypes.map(([Component]) => ComponentRow(OwnerId, Component));

// Inserts each owner's components right after the owner (and anything already under it).
export function WithObjectComponents(Rows) {
  const Result = [];
  for (const Row of Rows) {
    Result.push(Row);
    if (IsObjectOwner(Row) && !Rows.some((Each) => Each.Parent === Row.Id && Each.Panel === ComponentPanel)) Result.push(...ComponentRowsFor(Row.Id));
  }
  return Result;
}

// Saved scenes get components once (ComponentRevision), so a component removed later stays removed.
export function EnsureObjectComponents(Rows = [], Revision) {
  if (!Array.isArray(Rows) || Revision >= 1) return Rows;
  return WithObjectComponents(Rows);
}

const Read = (Values) => (Key, Initial) => (Values?.[Key] === undefined ? Initial : Values[Key]);
const SizeOf = (Owner, Values) => Measure(ShapeOf(Owner), Read(Values), Array.isArray(Values?.Scale) ? Values.Scale : [1, 1, 1]);
const Proxies = { box: "Box", sphere: "Sphere", capsule: "Capsule", convex: "Convex hull", sdf: "SDF" };

// Outliner value line, read from the owner's values.
export function ComponentSummary(Row, Owner, Values = {}) {
  if (!Owner) return "Owner removed";
  const R = Read(Values);
  if (Row.Component === "Mass") {
    const { Mass, Manual, Density } = MassOf(R, SizeOf(Owner, Values));
    return `${Mass >= 100 ? Mass.toFixed(0) : Mass.toFixed(Mass < 1 ? 3 : 1)} kg · ${Manual ? "set by hand" : Density}`;
  }
  if (Row.Component === "Rigid Body") {
    const Body = !Values.DYNAMIC ? "Static" : R("Physics Body", "dynamic").replace(/^./, (Letter) => Letter.toUpperCase());
    return `${Body} · ${Values.PHYSICS ? "simulated" : "not simulated"}`;
  }
  const Proxy = Proxies[CollisionProxy(ShapeOf(Owner), R)] || "Convex hull";
  return `${Proxy} · ${R("Physics Collides", true) ? "collides" : "ignored"}`;
}

// Overview card listing the object's components: each is a link that selects it; missing ones can be added back.
export function ComponentsCard({ Owner, Values, Scene, Kit }) {
  const { Icon } = Kit;
  const Rows = Scene?.Rows || [];
  const Present = Rows.filter((Each) => Each.Parent === Owner.Id && Each.Panel === ComponentPanel);
  const Missing = ObjectComponentTypes.filter(([Component]) => !Present.some((Each) => Each.Component === Component));
  return (
    <section className="pi-card pi-components-card" data-card="Components">
      <header className="pi-card-head">
        <h3>Components</h3>
        <span className="pi-card-aside">{Present.length} on this object</span>
      </header>
      <div className="oc-list">
        {Present.map((Row) => (
          <button key={Row.Id} type="button" className="oc-link" data-component={Row.Component} onClick={() => Scene?.SelectRow?.(Row.Id)} title={`Select ${Row.Name}`}>
            {Icon && <Icon Name={Row.Icon} Size={22} />}
            <span>
              <b>{Row.Name}</b>
              <small>{ComponentSummary(Row, Owner, Values)}</small>
            </span>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
      {Missing.length > 0 && Scene?.AddRows && (
        <div className="oc-add">
          {Missing.map(([Component]) => (
            <button key={Component} type="button" onClick={() => Scene.AddRows(Owner.Id, [ComponentRow(Owner.Id, Component)])}>
              + {Component}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
