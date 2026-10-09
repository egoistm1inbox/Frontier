// Construct: the layer library as a modal dialog. Groups follow the Gaea
// families, and texture operations sit in the texturing stack.
import React, { useState } from "react";
import Glyph, { GroupGlyph } from "./Glyph.jsx";
import {
  TerrainOperations, TextureOperations, PlannedTerrainNodes, LayerGroupOrder, TextureGroupOrder,
} from "../engine/LayerSpecification.js";

export default function ConstructPanel({ Kind, SetKind, OnAdd, OnClose }) {
  const IsTexture = Kind === "Texture";
  const List = IsTexture ? TextureOperations : TerrainOperations;
  const Groups = IsTexture ? TextureGroupOrder : [...LayerGroupOrder, "Planned"];
  const [Group, SetGroup] = useState(Groups[0]);
  const Visible = Group === "Planned" ? [] : List.filter((Entry) => Entry.Group === Group);
  return (
    <div
      className="construct-overlay"
      onMouseDown={(Event) => {
        if (Event.target === Event.currentTarget) OnClose();
      }}
    >
      <section className="construct-dialog" role="dialog" aria-modal="true" aria-label="Construct layers">
        <header>
          <h2>Construct</h2>
          <div className="construct-kinds" role="group" aria-label="Stack">
            <button className={!IsTexture ? "active" : ""} aria-pressed={!IsTexture} onClick={() => { SetKind("Terrain"); SetGroup(LayerGroupOrder[0]); }}>Terrain stack</button>
            <button className={IsTexture ? "active" : ""} aria-pressed={IsTexture} onClick={() => { SetKind("Texture"); SetGroup(TextureGroupOrder[0]); }}>Texturing stack</button>
          </div>
          <button className="icon-button" aria-label="Close construct" onClick={OnClose}>
            <Glyph Name="close" />
          </button>
        </header>
        <nav className="construct-rail" aria-label="Groups">
          {Groups.map((Entry) => (
            <button key={Entry} className={Entry === Group ? "active" : ""} onClick={() => SetGroup(Entry)}>
              <Glyph Name={GroupGlyph(Entry)} Size={16} /> {Entry}
            </button>
          ))}
        </nav>
        <div className="construct-grid">
          {Visible.map((Entry) => {
            const Deferred = Entry.Status === "Deferred";
            return (
              <button key={Entry.Id} className={"construct-tile " + (Deferred ? "deferred" : "")} disabled={Deferred} onClick={() => OnAdd(Entry.Id)}>
                <span className="construct-glyph"><Glyph Name={GroupGlyph(Entry.Group)} Size={22} /></span>
                <strong>{Entry.Name}</strong>
                <small>{Entry.Summary}</small>
                <em className="gaea-chip">{Deferred ? "Deferred" : Entry.Gaea}</em>
              </button>
            );
          })}
          {Group === "Planned" && (
            <>
              <p className="muted planned-note">These Gaea nodes are not yet layers. Each one maps to a layer in the same stack, so the gap is visible and tracked.</p>
              {PlannedTerrainNodes.map((Name) => (
                <div key={Name} className="construct-tile planned" aria-disabled="true">
                  <span className="construct-glyph"><Glyph Name="layers" Size={22} /></span>
                  <strong>{Name}</strong>
                  <small>Planned layer</small>
                  <em className="gaea-chip">Planned</em>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
