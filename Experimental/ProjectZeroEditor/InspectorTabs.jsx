//============================================================================================================================================
//                                                              INSPECTORTABS.JSX
//============================================================================================================================================
// 🧩 Lettered tabs [A | B | C …] for the environment and camera inspectors, like the Showcase object's category carousel, each drawn in
// its own way so no two inspectors look alike:
//   • strata         Atmosphere: the bar is a slice of sky over a planet's limb; the open tab glows like scattered light.
//   • arc            Sun: the tabs stand along the sun's path from sunrise to sunset; the open one is the sun.
//   • constellation  Stars: the tabs are stars joined into a constellation; the open one sparkles.
//   • aperture       Lens Flare: hexagonal ghosts strung along a flare streak; the open ghost carries the chromatic ring.
//   • viewfinder     Camera: frame lines with corner marks; the open tab is underlined with a recording dot and the count shows.
//   • phases         Moon: moon phases from crescent to full; the open tab is the full moon.
// Every page stays in the document (hidden when shut) so its inputs keep their values and the BAKING page stays last. The open tab is
// remembered per inspector. ← and → move between tabs.

import React, { useState } from "react";
import "./InspectorTabs.css";

const Opened = {};
const Letter = (Index) => String.fromCharCode(65 + Index);

export function InspectorTabs({ Owner, Look, Pages }) {
  const [Open, Choose] = useState(() => (Pages.some((Page) => Page.Id === Opened[Owner]) ? Opened[Owner] : Pages[0].Id));
  const Index = Math.max(0, Pages.findIndex((Page) => Page.Id === Open));
  const Pick = (Id) => {
    Opened[Owner] = Id;
    Choose(Id);
  };
  const Keys = (Event) => {
    const Step = Event.key === "ArrowRight" ? 1 : Event.key === "ArrowLeft" ? -1 : 0;
    if (!Step) return;
    Event.preventDefault();
    const Next = Pages[(Index + Step + Pages.length) % Pages.length];
    Pick(Next.Id);
    Event.currentTarget.querySelector(`[data-tab-for="${Owner}:${Next.Id}"]`)?.focus();
  };
  const Draw = Looks[Look] || Looks.strata;
  return (
    <div className={"inspector-tabs it-" + Look} data-tabs={Owner} data-tabs-look={Look}>
      <div className="it-bar" role="tablist" aria-label={Owner + " pages"} onKeyDown={Keys}>
        {Draw({ Pages, Index, Owner, Tab: (Page, At, Inside, Extra = {}) => (
          <button
            key={Page.Id}
            type="button"
            role="tab"
            id={`tab-${Owner}-${Page.Id}`}
            aria-selected={At === Index}
            aria-controls={`page-${Owner}-${Page.Id}`}
            tabIndex={At === Index ? 0 : -1}
            className={"it-tab" + (At === Index ? " open" : "")}
            data-tab-for={`${Owner}:${Page.Id}`}
            onClick={() => Pick(Page.Id)}
            {...Extra}
          >
            {Inside}
          </button>
        ) })}
      </div>
      {Pages.map((Page, At) => (
        <section
          key={Page.Id}
          id={`page-${Owner}-${Page.Id}`}
          role="tabpanel"
          aria-labelledby={`tab-${Owner}-${Page.Id}`}
          className="it-page"
          data-tab-page={`${Owner}:${Page.Id}`}
          hidden={At !== Index}
        >
          {Page.Content}
        </section>
      ))}
    </div>
  );
}

const Looks = {
  strata: ({ Pages, Tab }) => (
    <>
      <svg className="it-strata-limb" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 20 Q50 6 100 20 Z" />
        <path className="it-strata-rim" d="M0 20 Q50 6 100 20" />
      </svg>
      {Pages.map((Page, At) =>
        Tab(Page, At, <>
          <b>{Letter(At)}</b>
          <span>{Page.Label}</span>
        </>),
      )}
    </>
  ),
  arc: ({ Pages, Index, Tab }) => {
    const Places = Pages.map((_, At) => {
      const Turn = ((At + 0.5) / Pages.length) * Math.PI;
      return [50 - 44 * Math.cos(Turn), 84 - 52 * Math.sin(Turn)];
    });
    return (
      <>
        <svg className="it-arc-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M6 84 A44 52 0 0 1 94 84" />
          <path className="it-arc-lit" d={`M6 84 A44 52 0 0 1 ${Places[Index][0].toFixed(2)} ${Places[Index][1].toFixed(2)}`} />
          <line x1="0" y1="84" x2="100" y2="84" />
        </svg>
        {Pages.map((Page, At) =>
          Tab(
            Page,
            At,
            <>
              <i className="it-arc-sun" />
              <span>
                <b>{Letter(At)}</b> {Page.Label}
              </span>
            </>,
            { style: { left: Places[At][0] + "%", top: Places[At][1] + "%" } },
          ),
        )}
      </>
    );
  },
  constellation: ({ Pages, Tab }) => {
    const Places = Pages.map((_, At) => [8 + (84 * At) / Math.max(1, Pages.length - 1), At % 2 ? 62 : 30]);
    return (
      <>
        <svg className="it-constellation-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={Places.map((Place) => Place.join(",")).join(" ")} />
        </svg>
        {Pages.map((Page, At) =>
          Tab(
            Page,
            At,
            <>
              <i className="it-star" />
              <span>
                {Page.Label}
                <b>{Letter(At)}</b>
              </span>
            </>,
            { style: { left: Places[At][0] + "%", top: Places[At][1] + "%" } },
          ),
        )}
      </>
    );
  },
  aperture: ({ Pages, Tab }) => (
    <>
      <i className="it-aperture-streak" aria-hidden="true" />
      {Pages.map((Page, At) =>
        Tab(Page, At, <>
          <i className="it-ghost">
            <b>{Letter(At)}</b>
          </i>
          <span>{Page.Label}</span>
        </>),
      )}
    </>
  ),
  viewfinder: ({ Pages, Index, Tab }) => (
    <>
      <i className="it-corner tl" aria-hidden="true" />
      <i className="it-corner tr" aria-hidden="true" />
      <i className="it-corner bl" aria-hidden="true" />
      <i className="it-corner br" aria-hidden="true" />
      {Pages.map((Page, At) =>
        Tab(Page, At, <>
          <em aria-hidden="true" />
          {Letter(At)} · {Page.Label}
        </>),
      )}
      <output className="it-viewfinder-count" aria-hidden="true">
        {Letter(Index)}/{Letter(Pages.length - 1)}
      </output>
    </>
  ),
  phases: ({ Pages, Index, Tab }) =>
    Pages.map((Page, At) => {
      // Crescent → full across the tabs; the open tab is full.
      const Lit = At === Index ? 1 : 0.2 + (0.6 * At) / Math.max(1, Pages.length - 1);
      return Tab(Page, At, <>
        <i className="it-phase" style={{ "--lit": Lit }} />
        <span>
          <b>{Letter(At)}</b>
          {Page.Label}
        </span>
      </>);
    }),
};
