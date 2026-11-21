//============================================================================================================================================
//                                                          OBJECTCOMPONENTS.JSX
//============================================================================================================================================
// 🧩 Components: outliner rows that hang under an owner the way the post effects hang under Post Process. Showcase objects carry
// Mass, Rigid Body and Collision; cameras carry one Render Engine component (RenderComponents.jsx). Each row has its own inspector, but the values live on the owner (Values[Owner]), so the
// owner's viewport, checks and quick controls keep reading the same keys. Browser authoring only.

import React from "react";
import "./ObjectComponents.css";
import { ShapeOf, Measure, MassOf, MassText, CollisionProxy } from "./PrimitiveInspector.jsx";
import { RenderComponentTypes, RetiredRenderComponents, RenderSummary } from "./RenderComponents.jsx";

export const ComponentPanel = "object-component";
export const ComponentSheet = [];

// Component, baked icon, description, per owner kind.
export const ComponentTypes = {
  object: [
    ["Mass", "editor-mass", "Mass from a material or set directly, in any unit"],
    ["Rigid Body", "editor-physics", "Body type, contact and damping"],
    ["Collision", "editor-box-collider", "Collision shape and filtering"],
  ],
  camera: RenderComponentTypes.map(([Name, Icon, Description]) => [Name, Icon, Description]),
};
// The revision each kind's components arrived in (saved scenes below it gain them once).
const Arrival = { object: 1, camera: 2 };
// Components retired at a revision (saved scenes below it lose them once): Follow-up 41 split camera render settings over five rows;
// Follow-up 42 folds them back into Render Engine.
const Retired = { 3: RetiredRenderComponents };
export const ComponentRevision = 3;

const Slug = (Component) => Component.toLowerCase().replace(/\s+/g, "-");
export const OwnerKind = (Row) => (Row?.Panel === "geometry" && Row.Parent === "showcase" ? "object" : Row?.Panel === "camera" ? "camera" : null);
const TypesOf = (Row) => ComponentTypes[OwnerKind(Row)] || [];

export function ComponentRow(Owner, Component) {
  const Types = TypesOf(Owner);
  const [, Icon, Description] = Types.find(([Name]) => Name === Component) || Types[0];
  return { Id: `${Owner.Id}-${Slug(Component)}`, Name: Component, Panel: ComponentPanel, Icon, Parent: Owner.Id, Description, Component };
}
export const ComponentRowsFor = (Owner) => TypesOf(Owner).map(([Component]) => ComponentRow(Owner, Component));

// Inserts each owner's components right after the owner, for owner kinds that arrived after `Revision`.
export function WithObjectComponents(Rows, Revision = 0) {
  const Result = [];
  for (const Row of Rows) {
    Result.push(Row);
    const Kind = OwnerKind(Row);
    if (!Kind || Arrival[Kind] <= Revision) continue;
    const Present = new Set(Rows.filter((Each) => Each.Parent === Row.Id && Each.Panel === ComponentPanel).map((Each) => Each.Component));
    Result.push(...ComponentRowsFor(Row).filter((Each) => !Present.has(Each.Component)));
  }
  return Result;
}

// Saved scenes gain each kind's components once (ComponentRevision), so a component removed later stays removed.
export function EnsureObjectComponents(Rows = [], Revision) {
  const Seen = +Revision || 0;
  if (!Array.isArray(Rows) || Seen >= ComponentRevision) return Rows;
  const Gone = new Set(Object.entries(Retired).filter(([At]) => +At > Seen).flatMap(([, Names]) => Names));
  const Owners = new Map(Rows.map((Row) => [Row.Id, Row]));
  const Kept = Rows.filter((Row) => !(Row.Panel === ComponentPanel && Gone.has(Row.Component) && OwnerKind(Owners.get(Row.Parent)) === "camera"));
  return WithObjectComponents(Kept, Seen);
}

const Read = (Values) => (Key, Initial) => (Values?.[Key] === undefined ? Initial : Values[Key]);
const SizeOf = (Owner, Values) => Measure(ShapeOf(Owner), Read(Values), Array.isArray(Values?.Scale) ? Values.Scale : [1, 1, 1]);
const Proxies = { box: "Box", sphere: "Sphere", capsule: "Capsule", convex: "Convex hull", sdf: "SDF" };

// Outliner value line, read from the owner's values.
export function ComponentSummary(Row, Owner, Values = {}) {
  if (!Owner) return "Owner removed";
  if (OwnerKind(Owner) === "camera") return RenderSummary(Row.Component, Values);
  const R = Read(Values);
  if (Row.Component === "Mass") {
    const { Mass, Manual, Density, Unit: Shown } = MassOf(R, SizeOf(Owner, Values));
    return `${MassText(Mass, Shown)} · ${Manual ? "set directly" : Density}`;
  }
  if (Row.Component === "Rigid Body") {
    const Body = !Values.DYNAMIC ? "Static" : R("Physics Body", "dynamic").replace(/^./, (Letter) => Letter.toUpperCase());
    return `${Body} · ${Values.PHYSICS ? "simulated" : "not simulated"}`;
  }
  const Proxy = Proxies[CollisionProxy(ShapeOf(Owner), R)] || "Convex hull";
  return `${Proxy} · ${R("Physics Collides", true) ? "collides" : "ignored"}`;
}

// Overview card listing the object's components: each is a link that selects it; missing ones can be added back.
export function ComponentsCard({ Owner, Values, Scene, Kit, Title = "Components" }) {
  const { Icon } = Kit;
  const Rows = Scene?.Rows || [];
  const Present = Rows.filter((Each) => Each.Parent === Owner.Id && Each.Panel === ComponentPanel);
  const Missing = TypesOf(Owner).filter(([Component]) => !Present.some((Each) => Each.Component === Component));
  return (
    <section className="pi-card pi-components-card" data-card="Components">
      <header className="pi-card-head">
        <h3>{Title}</h3>
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
            <button key={Component} type="button" onClick={() => Scene.AddRows(Owner.Id, [ComponentRow(Owner, Component)])}>
              + {Component}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
