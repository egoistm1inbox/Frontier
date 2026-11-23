//============================================================================================================================================
//                                                                QUICKMENU.JSX
//============================================================================================================================================
// 🧩 The tool menus of the remastered Texture Studio (Follow-up 80), brought to the ShaderEditor's Texture paint, Pattern and Stamp tabs.
//   • useQuickMenu: the logic the remastered studio uses. A right-click on the viewport opens the menu where it was pressed, but only
//     when the pointer moved less than 5 px while the button was down (a right-drag still moves the camera). Q opens or shuts it while
//     the pointer is over the workspace, Esc shuts it, a press outside shuts it. The menu waits for the right button to come up, so a
//     drag that begins with a context menu event (Linux, macOS) never opens it.
//   • QuickMenu: the floating card, drawn in a portal on the page so the ShaderEditor's own panes never clip it.
//   • MenuTabs, MenuChips and MenuLabel: its rows — the tool grid, the pill strips and the small captions.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./QuickMenu.css";

const Travel = 5;
const Typing = (Target) => /input|select|textarea/i.test(Target?.tagName || "") || Target?.isContentEditable;

// Root: the workspace (keys work while the pointer is over it). Keys: the keys that open the menu as well as Q.
export function useQuickMenu(Root, { Keys = [], Before } = {}) {
  const [At, Place] = useState(null);
  const Press = useRef(null), Pointer = useRef(null), Area = useRef(null), Menu = useRef(null);
  const Latest = useRef({});
  Latest.current = { At, Before };
  const Show = (X, Y) => Place({ X, Y });
  const Hide = () => Place(null);
  const Toggle = (X, Y) => (Latest.current.At ? Hide() : Show(X, Y));
  // Where Q opens it: the last pointer position over the viewport, or near the top of the viewport.
  const Anchor = () => {
    if (Pointer.current) return Pointer.current;
    const Box = Area.current?.getBoundingClientRect();
    return Box ? { X: Box.left + Box.width / 2 - 180, Y: Box.top + 56 } : { X: 120, Y: 120 };
  };
  useEffect(() => {
    const Shortcut = (Event) => {
      if (Typing(Event.target) || Event.ctrlKey || Event.metaKey || Event.altKey) return;
      const Inside = Root.current?.matches(":hover") || Menu.current?.contains(Event.target);
      if (Event.key === "Escape" && Latest.current.At) {
        Event.preventDefault();
        Event.stopPropagation();
        Hide();
        return;
      }
      if (!Inside) return;
      const Key = Event.key.length === 1 ? Event.key.toLowerCase() : Event.key;
      if (Key !== "q" && !Keys.includes(Key)) return;
      if (Key === "Tab" && !Area.current?.matches(":hover") && !Latest.current.At) return;
      Event.preventDefault();
      Event.stopPropagation();
      const Spot = Anchor();
      Toggle(Spot.X, Spot.Y);
    };
    window.addEventListener("keydown", Shortcut, true);
    return () => window.removeEventListener("keydown", Shortcut, true);
  });
  useEffect(() => {
    if (!At) return;
    const Outside = (Event) => {
      if (Menu.current?.contains(Event.target) || Event.target.closest?.("[data-quick-menu-toggle]")) return;
      // A right press on the viewport is answered by its context menu event (which shuts or moves the menu).
      if (Event.button === 2 && Area.current?.contains(Event.target)) return;
      Hide();
    };
    document.addEventListener("pointerdown", Outside, true);
    return () => document.removeEventListener("pointerdown", Outside, true);
  }, [At]);
  // Spread onto the viewport element.
  const Viewport = {
    ref: Area,
    onPointerMoveCapture: (Event) => {
      Pointer.current = { X: Event.clientX, Y: Event.clientY };
    },
    onPointerLeave: () => {
      Pointer.current = null;
    },
    onPointerDownCapture: (Event) => {
      if (Event.button !== 2) return;
      const Down = { X: Event.clientX, Y: Event.clientY, Held: true, Far: false, Wanted: null };
      Press.current = Down;
      const Track = (Move) => {
        if (Math.hypot(Move.clientX - Down.X, Move.clientY - Down.Y) >= Travel) Down.Far = true;
      };
      const Release = () => {
        Down.Held = false;
        window.removeEventListener("pointermove", Track, true);
        window.removeEventListener("pointerup", Release, true);
        if (Down.Wanted && !Down.Far) Open(Down.Wanted);
        Down.Wanted = null;
      };
      window.addEventListener("pointermove", Track, true);
      window.addEventListener("pointerup", Release, true);
    },
    onContextMenuCapture: (Event) => {
      Event.preventDefault();
      Event.stopPropagation();
      const Down = Press.current, Spot = { X: Event.clientX, Y: Event.clientY, Target: Event.target };
      if (Down?.Held) {
        Down.Wanted = Spot; // opened when the button comes up, unless it travelled
        return;
      }
      if (Down && (Down.Far || Math.hypot(Spot.X - Down.X, Spot.Y - Down.Y) >= Travel)) return;
      Open(Spot);
    },
  };
  function Open(Spot) {
    Press.current = null;
    if (Latest.current.At) return Hide();
    Latest.current.Before?.(Spot.Target);
    Show(Spot.X, Spot.Y);
  }
  return { At, Show, Hide, Toggle: () => { const Spot = Anchor(); Toggle(Spot.X, Spot.Y); }, Viewport, Menu };
}

// The floating card. Category names it for the page (data-quick-menu); Width is its width in px.
export function QuickMenu({ Control, Category, Glyph, Title, Keys, Width = 360, children }) {
  const Box = useRef(null);
  const [Spot, Settle] = useState(null);
  useLayoutEffect(() => {
    if (!Control.At || !Box.current) return;
    const Rect = Box.current.getBoundingClientRect();
    const Wide = window.innerWidth || 1280, Tall = window.innerHeight || 800;
    const Left = Math.max(12, Math.min(Control.At.X, Wide - Rect.width - 12));
    const Top = Math.max(12, Math.min(Control.At.Y, Tall - Rect.height - 12));
    if (!Spot || Spot.Left !== Left || Spot.Top !== Top) Settle({ Left, Top });
  });
  useEffect(() => {
    if (!Control.At) Settle(null);
  }, [Control.At]);
  if (!Control.At) return null;
  return createPortal(
    <div
      ref={(Node) => {
        Box.current = Node;
        Control.Menu.current = Node;
      }}
      className="qm-card"
      role="dialog"
      aria-label={Title}
      data-quick-menu={Category}
      style={{ width: Width, left: Spot ? Spot.Left : Control.At.X, top: Spot ? Spot.Top : Control.At.Y, visibility: Spot ? "visible" : "hidden" }}
      onContextMenu={(Event) => Event.preventDefault()}
    >
      <header className="qm-head">
        <span className="qm-glyph">{Glyph}</span>
        <strong>{Title}</strong>
        <small>{Keys}</small>
        <button type="button" className="qm-close" aria-label="Close quick menu" title="Close · Esc" onClick={Control.Hide}>
          <X size={13} />
        </button>
      </header>
      <div className="qm-body">{children}</div>
    </div>,
    document.body,
  );
}

// Tabs: [[Id, Caption, Glyph]] — a grid of tools; Active the chosen Id.
export function MenuTabs({ Label, Tabs, Active, Pick, Columns }) {
  return (
    <div className="qm-tabs" role="tablist" aria-label={Label} style={{ gridTemplateColumns: `repeat(${Columns || Math.min(Tabs.length, 5)}, minmax(0, 1fr))` }}>
      {Tabs.map(([Id, Caption, Glyph]) => (
        <button key={Id} type="button" role="tab" aria-selected={Active === Id} className={"qm-tab" + (Active === Id ? " on" : "")} onClick={() => Pick(Id)}>
          {Glyph && <Glyph size={13} />}
          <span>{Caption}</span>
        </button>
      ))}
    </div>
  );
}

// Section switches under the tool grid (the remastered studio's sub tabs).
export function MenuSections({ Label, Sections, Active, Pick }) {
  return (
    <div className="qm-sections" role="tablist" aria-label={Label} style={{ gridTemplateColumns: `repeat(${Sections.length}, minmax(0, 1fr))` }}>
      {Sections.map(([Id, Caption]) => (
        <button key={Id} type="button" role="tab" aria-selected={Active === Id} className={"qm-section" + (Active === Id ? " on" : "")} onClick={() => Pick(Id)}>
          {Caption}
        </button>
      ))}
    </div>
  );
}

export function MenuLabel({ children, Note }) {
  return (
    <div className="qm-label">
      <span>{children}</span>
      {Note && <small>{Note}</small>}
    </div>
  );
}

// Chips: [[Id, Caption, On, Choose, Disabled, Title]]
export function MenuChips({ Label, Chips }) {
  return (
    <div className="qm-chips" role="group" aria-label={Label}>
      {Chips.map(([Id, Caption, On, Choose, Disabled, Title]) => (
        <button key={Id} type="button" className={"qm-chip" + (On ? " on" : "")} aria-pressed={On === undefined ? undefined : !!On} disabled={Disabled} title={Title} onClick={Choose}>
          {Caption}
        </button>
      ))}
    </div>
  );
}
