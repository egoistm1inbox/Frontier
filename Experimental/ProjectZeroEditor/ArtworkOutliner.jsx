//============================================================================================================================================
//                                                             ARTWORKOUTLINER.JSX
//============================================================================================================================================
// 🧩 The layer stack of the ShaderEditor's Pattern and Stamp workspaces, drawn as the editor's scene Outliner is (Follow-up 72):
//   • A heading: the stack's name at 20 px, a quiet line of detail, and round buttons at the right.
//   • Two count cards — Visible (shows every layer) and Hidden (hides every unlocked layer) — as on the Outliner.
//   • A rounded search field with a Filter button beside it (All, Visible, Hidden, Locked).
//   • Tree rows 39 px tall: a disclosure chevron for groups and folders, a 24 px picture, the name over a line of detail, the green
//     status disc (a lock once the layer is locked) and the eye, which shows on hover or on the chosen row. The chosen row carries the
//     Outliner's amber edge.
//   • A footer strip for the stack's own actions.
// It only draws; each workspace passes its rows and what every control does.

import React, { useEffect, useRef, useState } from "react";
import { Glyph, Icon } from "./Inspectors.jsx";

export function OutlinerHeading({ Title, Detail, children }) {
  return (
    <div className="ao-heading">
      <h1>{Title}</h1>
      <small>{Detail}</small>
      <span className="ao-heading-actions">{children}</span>
    </div>
  );
}

const Filters = [
  ["all", "All layers"],
  ["visible", "Visible"],
  ["hidden", "Hidden"],
  ["locked", "Locked"],
];
function FilterButton({ Title, Filter, Sift }) {
  const [Open, Show] = useState(false), Anchor = useRef(null);
  useEffect(() => {
    if (!Open) return;
    const Close = (Event) => {
      if (Event.type === "keydown" ? Event.key !== "Escape" : Anchor.current?.contains(Event.target)) return;
      if (Event.type === "keydown") Event.stopPropagation();
      Show(false);
    };
    document.addEventListener("pointerdown", Close, true);
    document.addEventListener("keydown", Close, true);
    return () => {
      document.removeEventListener("pointerdown", Close, true);
      document.removeEventListener("keydown", Close, true);
    };
  }, [Open]);
  return (
    <div className="ao-filter" ref={Anchor}>
      <button type="button" aria-label={"Filter " + Title.toLowerCase()} aria-expanded={Open} className={Filter !== "all" ? "on" : ""} onClick={() => Show(!Open)}>
        <Glyph Name="filter" Size={13} />
        {Filter === "all" ? "Filter" : Filters.find(([Id]) => Id === Filter)[1]}
        <Glyph Name="chevron" Size={12} />
      </button>
      {Open && (
        <div className="ao-filter-menu" role="menu" aria-label={Title + " filter"}>
          {Filters.map(([Id, Caption]) => (
            <button
              key={Id}
              type="button"
              role="menuitemradio"
              aria-checked={Filter === Id}
              onClick={() => {
                Sift(Id);
                Show(false);
              }}
            >
              {Caption}
              {Filter === Id && <Glyph Name="check" Size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Rows: [{ Id, Name, Detail, Picture, Depth, Folder, Folded, Fold(), Chosen, Picked, Hidden, Locked, Pick(Event), Show(), Lock(),
//          Drag (props for dragging), Below (drawn under the row, indented), Label (accessible name) }]
// Tallies (Follow-up 75): the two count cards' own captions and actions, [[Caption, Count, Act, Title], [...]], for stacks whose rows
// are not shown and hidden (UV islands, fracture pieces, cluster levels); without it they are Visible and Hidden.
export default function ArtworkOutliner({ Title, Detail, Actions, Visible, Hidden, ShowAll, HideAll, Query, Search, Filter, Sift, Label, Rows, Empty, Footer, Tallies = null }) {
  return (
    <div className="ao-outliner">
      <OutlinerHeading Title={Title} Detail={Detail}>
        {Actions}
      </OutlinerHeading>
      <div className="ao-stats">
        <button type="button" onClick={Tallies ? Tallies[0][2] : ShowAll} title={Tallies ? Tallies[0][3] : "Show every " + Title.toLowerCase().replace(/s$/, "")}>
          <span className="ao-status-disc">
            <Glyph Name="check" Size={15} />
          </span>
          <small>{Tallies ? Tallies[0][0] : "Visible"}</small>
          <strong>{Tallies ? Tallies[0][1] : Visible}</strong>
        </button>
        <button type="button" onClick={Tallies ? Tallies[1][2] : HideAll} title={Tallies ? Tallies[1][3] : "Hide every unlocked " + Title.toLowerCase().replace(/s$/, "")}>
          <span className="ao-muted-disc">△</span>
          <small>{Tallies ? Tallies[1][0] : "Hidden"}</small>
          <strong>{Tallies ? Tallies[1][1] : Hidden}</strong>
        </button>
      </div>
      <div className="ao-search">
        <label>
          <Glyph Name="search" Size={15} />
          <input aria-label={"Search " + Title.toLowerCase()} placeholder="Search" value={Query} onChange={(Event) => Search(Event.target.value)} />
        </label>
        <FilterButton Title={Title} Filter={Filter} Sift={Sift} />
      </div>
      <div className="ao-rows" role="tree" aria-label={Label}>
        {Rows.map((Row) => (
          <React.Fragment key={Row.Id}>
            <div
              role="treeitem"
              tabIndex={0}
              aria-label={Row.Label || Row.Name}
              aria-selected={!!Row.Chosen}
              aria-expanded={Row.Folder ? !Row.Folded : undefined}
              className={"ao-row" + (Row.Chosen ? " chosen" : Row.Picked ? " picked" : "") + (Row.Hidden ? " hidden-row" : "") + (Row.Locked ? " locked" : "")}
              style={{ "--depth": Math.min(5, Row.Depth || 0) }}
              onClick={(Event) => Row.Pick?.(Event)}
              onDoubleClick={() => Row.Folder && Row.Fold?.()}
              onKeyDown={(Event) => {
                if (Event.target !== Event.currentTarget) return;
                if (Event.key === "Enter") {
                  Event.preventDefault();
                  Event.stopPropagation();
                  Row.Pick?.(Event);
                }
                if (Row.Folder && (Event.key === "ArrowRight" || Event.key === "ArrowLeft") && !!Row.Folded === (Event.key === "ArrowRight")) {
                  Event.stopPropagation();
                  Row.Fold?.();
                }
              }}
              {...(Row.Drag || {})}
            >
              <button
                type="button"
                tabIndex={-1}
                className={"ao-disclosure" + (Row.Folder ? "" : " empty")}
                aria-label={(Row.Folded ? "Unfold " : "Fold ") + Row.Name}
                style={{ transform: Row.Folded ? "rotate(-90deg)" : undefined }}
                onClick={(Event) => {
                  Event.stopPropagation();
                  Row.Fold?.();
                }}
              >
                <Glyph Name="chevron" Size={12} />
              </button>
              <span className="ao-picture">{Row.Picture}</span>
              <div className="ao-caption">
                <span className="ao-name">{Row.Name}</span>
                <small title={Row.Detail}>{Row.Detail}</small>
              </div>
              {Row.Lock && (
                <button
                  type="button"
                  className={"ao-lock" + (Row.Locked ? " on" : "")}
                  aria-label={(Row.Locked ? "Unlock " : "Lock ") + (Row.Label || Row.Name)}
                  title={Row.Locked ? "Unlock" : "Lock"}
                  onClick={(Event) => {
                    Event.stopPropagation();
                    Row.Lock();
                  }}
                >
                  <Glyph Name={Row.Locked ? "LockClosed" : "LockOpen"} Size={12} />
                </button>
              )}
              {!Row.Locked && (
                <span className={"ao-row-status" + (Row.Hidden ? " off" : "")} aria-hidden="true">
                  <Glyph Name="check" Size={11} />
                </span>
              )}
              {Row.Show && (
                <button
                  type="button"
                  className="ao-visibility"
                  aria-label={(Row.Hidden ? "Show " : "Hide ") + (Row.Label || Row.Name)}
                  title={Row.Hidden ? "Show" : "Hide"}
                  onClick={(Event) => {
                    Event.stopPropagation();
                    Row.Show();
                  }}
                >
                  <Glyph Name={Row.Hidden ? "EyeHidden" : "eye"} Size={13} />
                </button>
              )}
            </div>
            {Row.Below && (
              <div className="ao-below" style={{ "--depth": Math.min(5, (Row.Depth || 0) + 1) }}>
                {Row.Below}
              </div>
            )}
          </React.Fragment>
        ))}
        {!Rows.length && <div className="ao-empty">{Empty}</div>}
      </div>
      {Footer && <div className="ao-footer">{Footer}</div>}
    </div>
  );
}

// The Outliner's own pictures for folders and groups.
export const FolderPicture = () => <Icon Name="folder-generic" Size={24} />;
export const GroupPicture = () => <Icon Name="collection-stacked-layers" Size={24} />;
