//============================================================================================================================================
//                                                              INSPECTORTABS.JSX
//============================================================================================================================================
// 🧩 Numbered inspector pages [1 | 2 | 3 …] for the environment, camera and vehicle inspectors, turned with the page carousel
// (PageCarousel.jsx, Follow-up 64): a strip under the heading (‹ · pills with flat number badges · › · count), the pages sliding across
// as they turn. It replaces the Follow-up 60 Orbit menu; Look is kept on the element (data-tabs-look) for the pages' own styling.
// Every page stays in the document (hidden when shut) so its inputs keep their values and the BAKING page stays last. The open page is
// remembered per inspector. ← and → move between pages.

import React, { useEffect, useState } from "react";
import { PageStrip, PageTurn, PageLook } from "./PageCarousel.jsx";
import "./InspectorTabs.css";

const Opened = {};

// Request ({ Id, Stamp }, optional) turns to a page from inside the pages (a new Stamp turns again).
export function InspectorTabs({ Owner, Look, Pages, Request = null }) {
  const [Open, Choose] = useState(() => (Pages.some((Page) => Page.Id === Opened[Owner]) ? Opened[Owner] : Pages[0].Id));
  const Index = Math.max(0, Pages.findIndex((Page) => Page.Id === Open));
  const Motion = PageTurn(Index);
  const Pick = (At) => {
    if (!Pages[At]) return;
    Motion.Turn(At);
    Opened[Owner] = Pages[At].Id;
    Choose(Pages[At].Id);
  };
  useEffect(() => {
    if (Request) Pick(Pages.findIndex((Page) => Page.Id === Request.Id));
  }, [Request?.Stamp]);
  return (
    <div className={"inspector-tabs it-" + Look} data-tabs={Owner} data-tabs-look={Look}>
      <PageStrip
        Owner={Owner}
        Index={Index}
        Pick={Pick}
        Pages={Pages.map((Page) => ({
          Id: Page.Id,
          Label: Page.Label,
          ClassName: "it-tab",
          Extra: { id: `tab-${Owner}-${Page.Id}`, "aria-controls": `page-${Owner}-${Page.Id}`, "data-tab-for": `${Owner}:${Page.Id}` },
        }))}
      />
      <div className={"pc-pages" + (Motion.Leaving !== null ? " pc-turning" : "")}>
        {Pages.map((Page, At) => {
          const { className, ...Shown } = PageLook(At, Index, Motion);
          return (
            <section
              key={Page.Id}
              id={`page-${Owner}-${Page.Id}`}
              role="tabpanel"
              aria-labelledby={`tab-${Owner}-${Page.Id}`}
              className={"it-page " + className}
              data-tab-page={`${Owner}:${Page.Id}`}
              {...Shown}
            >
              {Page.Content}
            </section>
          );
        })}
      </div>
    </div>
  );
}
