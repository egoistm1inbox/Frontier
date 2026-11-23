//============================================================================================================================================
//                                                              PAGECAROUSEL.JSX
//============================================================================================================================================
// 🧩 The inspector page carousel (Follow-up 64), used by every inspector with pages: the Showcase objects' categories
// (PrimitiveInspector.jsx), the Sun, Moon, Stars, Atmosphere, Lens Flare and camera pages (InspectorTabs.jsx) and the vehicles
// (VehicleAssetInspector.jsx). It replaces the Orbit menu.
//   • The strip sits under the inspector heading: ‹, a rail of pills, ›, then "3 / 6". Each pill has a flat number badge (no colour) and
//     its page name, which is cut short when the rail is narrow. The open pill is lit and scrolled into view.
//   • Turning a page slides it across: the new page comes in from the side it was picked from while the old one slides out the other
//     way. ← and → on the strip, the arrows, or a swipe across the page also turn it.
// PageStrip draws the strip. PageTurn keeps the page being left on screen while it slides out, so both can be drawn together.

import React, { useEffect, useRef, useState } from "react";
import "./PageCarousel.css";

const Chevron = ({ Back }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d={Back ? "M10 3.5L5.5 8l4.5 4.5" : "M6 3.5L10.5 8 6 12.5"} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Pages: [{ Id, Label, ClassName (more classes on the pill), Extra (more props on the pill) }]. Pick(At) turns to page At.
export function PageStrip({ Owner, Pages, Index, Pick, Label = null }) {
  const Rail = useRef(null);
  const [Hidden, Reveal] = useState("");
  const Count = Pages.length;
  // Which ends of the rail have pills scrolled out of sight ("start", "end" or both), so those edges fade.
  const Measure = () => {
    const Box = Rail.current;
    if (!Box) return;
    const More = [Box.scrollLeft > 1 && "start", Box.scrollLeft + Box.clientWidth < Box.scrollWidth - 1 && "end"].filter(Boolean).join(" ");
    Reveal((Was) => (Was === More ? Was : More));
  };
  useEffect(() => {
    Measure();
    const Watch = typeof ResizeObserver === "function" ? new ResizeObserver(Measure) : null;
    if (Rail.current) Watch?.observe(Rail.current);
    return () => Watch?.disconnect();
  }, [Count]);
  const Step = (By) => Pick((Index + By + Count) % Count);
  // The open pill stays in view (centred when the rail scrolls).
  useEffect(() => {
    const Box = Rail.current;
    const Pill = Box?.children[Index];
    if (!Box || !Pill || Box.scrollWidth <= Box.clientWidth) return;
    // Measured against the rail itself (a pill's offsetLeft counts from the nearest positioned ancestor instead).
    const Into = Box.scrollLeft + Pill.getBoundingClientRect().left - Box.getBoundingClientRect().left;
    Box.scrollTo({ left: Into - (Box.clientWidth - Pill.offsetWidth) / 2, behavior: "smooth" });
  }, [Index, Count]);
  const Keys = (Event) => {
    const By = Event.key === "ArrowRight" ? 1 : Event.key === "ArrowLeft" ? -1 : 0;
    if (!By) return;
    Event.preventDefault();
    const Next = (Index + By + Count) % Count;
    Pick(Next);
    Rail.current?.children[Next]?.focus();
  };
  return (
    <nav className="pc-strip" aria-label={Label || Owner + " pages"} data-strip={Owner}>
      <button type="button" className="pc-step" aria-label="Previous page" onClick={() => Step(-1)} disabled={Count < 2}>
        <Chevron Back />
      </button>
      <div className="pc-rail" role="tablist" aria-label={Label || Owner + " pages"} ref={Rail} onKeyDown={Keys} onScroll={Measure} data-more={Hidden || undefined}>
        {Pages.map((Page, At) => (
          <button
            key={Page.Id}
            type="button"
            role="tab"
            aria-selected={At === Index}
            aria-label={Page.Label}
            title={Page.Label}
            tabIndex={At === Index ? 0 : -1}
            className={"pc-pill" + (At === Index ? " open active" : "") + (Page.ClassName ? " " + Page.ClassName : "")}
            onClick={() => Pick(At)}
            {...(Page.Extra || {})}
          >
            <span className="pc-number" aria-hidden="true">
              {At + 1}
            </span>
            <span className="pc-caption">{Page.Label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="pc-step" aria-label="Next page" onClick={() => Step(1)} disabled={Count < 2}>
        <Chevron />
      </button>
      <span className="pc-count" aria-live="polite">
        {Index + 1} / {Count}
      </span>
    </nav>
  );
}

// The page being left while it slides out, and which way the pages move: { Leaving (its index or null), Way ("next" | "previous" |
// "none"), Turn (call with the new index before showing it), Settle (call when the slide ends) }.
export function PageTurn(Index) {
  const [Motion, Move] = useState({ Leaving: null, Way: "none" });
  const Timer = useRef(0);
  const Settle = () => {
    clearTimeout(Timer.current);
    Move((Now) => (Now.Leaving === null ? Now : { ...Now, Leaving: null }));
  };
  const Turn = (Next) => {
    if (Next === Index) return;
    const Still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    clearTimeout(Timer.current);
    Move({ Leaving: Still ? null : Index, Way: Next > Index ? "next" : "previous" });
    // The slide's own end clears it; this is in case the page was never drawn (a hidden inspector).
    if (!Still) Timer.current = setTimeout(Settle, 480);
  };
  useEffect(() => () => clearTimeout(Timer.current), []);
  return { ...Motion, Turn, Settle };
}

// Classes and props for a page: the open one slides in, the one being left slides out (drawn over the flow, not clickable, hidden from
// assistive technology), any other is hidden.
export function PageLook(At, Index, Motion) {
  if (At === Index) return { className: "pc-page pc-in-" + Motion.Way, hidden: false };
  if (At === Motion.Leaving)
    return {
      className: "pc-page pc-out-" + Motion.Way,
      hidden: false,
      "aria-hidden": true,
      inert: "",
      onAnimationEnd: (Event) => Event.target === Event.currentTarget && Motion.Settle(),
    };
  return { className: "pc-page", hidden: true };
}
