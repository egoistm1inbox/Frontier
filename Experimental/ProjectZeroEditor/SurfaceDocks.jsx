//============================================================================================================================================
//                                                               SURFACEDOCKS.JSX
//============================================================================================================================================
// 🧩 The chrome the Pattern and Stamp workspaces share with the editor itself (Follow-up 73):
//   • DockTabs — the editor's slanted document tabs along a dock's top edge. A tab can be closed (its dock folds away); the Viewport's
//     strip then shows a + that brings closed docks back.
//   • ViewportHeader — the Viewport dock's header, laid out as the editor's Viewport header is: a heading row (picture, name and detail,
//     the mode switch, small actions) over an action row (the light primary button, then the tools, then trailing controls).

import React from "react";
import { Glyph } from "./Inspectors.jsx";

export function DockTabs({ Label, Tabs, Active, Pick, Close, Restore }) {
  return (
    <div className="sfw-tab-strip" role="tablist" aria-label={Label}>
      {Tabs.map((Tab) => (
        <div
          key={Tab.Id}
          role="tab"
          tabIndex={0}
          aria-selected={Active === Tab.Id}
          className={"sfw-document-tab" + (Active === Tab.Id ? " active" : "")}
          onClick={() => Pick?.(Tab.Id)}
          onKeyDown={(Event) => (Event.key === "Enter" || Event.key === " ") && (Event.preventDefault(), Pick?.(Tab.Id))}
        >
          <span>{Tab.Label}</span>
          {Close && (
            <button
              type="button"
              aria-label={"Close " + Tab.Label + " tab"}
              title={"Close " + Tab.Label}
              onClick={(Event) => {
                Event.stopPropagation();
                Close(Tab.Id);
              }}
            >
              <Glyph Name="close" Size={13} />
            </button>
          )}
        </div>
      ))}
      {Restore && (
        <button type="button" className="sfw-tab-add" aria-label="Reopen closed docks" title="Reopen closed docks" onClick={Restore}>
          <Glyph Name="plus" Size={14} />
        </button>
      )}
    </div>
  );
}

// Modes: [[Id, Caption, Pressed, Choose]]
export function ViewportHeader({ Picture, Name, Detail, Badge, ModesLabel, Modes, Actions, Primary, Tools, Trailing }) {
  return (
    <div className="sfw-view-toolbar">
      <div className="sfw-view-heading">
        <div className="sfw-view-title">
          {Picture}
          <div>
            {Name}
            <span>{Detail}</span>
          </div>
          {Badge && <span className="sfw-view-badge">{Badge}</span>}
        </div>
        <div className="sfw-view-end">
          <div className="sfw-view-modes" role="group" aria-label={ModesLabel}>
            {Modes.map(([Id, Caption, Pressed, Choose]) => (
              <button key={Id} type="button" className={Pressed ? "active" : ""} aria-pressed={Pressed} onClick={Choose}>
                {Caption}
              </button>
            ))}
          </div>
          {Actions}
        </div>
      </div>
      <div className="sfw-view-actions" role="toolbar" aria-label="Viewport tools">
        {Primary}
        <span className="sfw-view-divider" />
        {Tools}
        <div className="sfw-view-trailing">{Trailing}</div>
      </div>
    </div>
  );
}
