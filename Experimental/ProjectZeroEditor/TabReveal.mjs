// For the checks: the numbered inspector pages (InspectorTabs.jsx) and the Showcase categories are turned with the page carousel
// (PageCarousel.jsx, Follow-up 64), whose strip of pills is always on screen above the pages.

// Kept for older checks: the strip needs no opening (Follow-up 60's Orbit ring did); waits until Owner's strip is there.
export async function OpenOrbit(Page, Owner = null) {
  await Page.locator(Owner ? `[data-strip="${Owner}"]` : ".pc-strip").first().waitFor();
}
// Turns to a numbered page ("owner:page") and waits for its slide to end.
export async function PickTab(Page, Tab) {
  if (await Page.locator(`[data-tab-page="${Tab}"]:not([hidden]):not([aria-hidden])`).count()) return;
  await Page.locator(`[data-tab-for="${Tab}"]`).click();
  await Page.locator(`[data-tab-page="${Tab}"]`).waitFor();
  await Settled(Page);
}
// Waits for any page slide to finish (the page being left is gone).
export async function Settled(Page) {
  await Page.waitForFunction(() => !document.querySelector(".pc-turning"));
}
// A Showcase category pill (by name): click() turns to it and waits for the slide to end.
export async function CategoryPill(Page, Name) {
  const Pill = Page.locator(`[data-strip="Category"] .pi-pill[aria-label="${Name}"]`);
  return {
    Pill,
    click: async (Options) => {
      await Pill.click(Options);
      await Settled(Page);
    },
  };
}
// Turns to a Showcase category.
export async function PickCategory(Page, Name) {
  await (await CategoryPill(Page, Name)).click();
  await Page.locator(`.pi-page[aria-label="${Name}"]:not([aria-hidden])`).waitFor();
}

// Opens the numbered page holding a control, when that page is shut.
export async function OpenTabOf(Target) {
  const Tab = await Target.evaluate((Each) => {
    const Holder = Each.closest("[data-tab-page]");
    return Holder?.hidden ? Holder.dataset.tabPage : null;
  });
  if (Tab) await PickTab(Target.page(), Tab);
}
// The same for a control found by its accessible label or a card by its title (role locators skip shut pages, so they can't be used).
export async function OpenTabWith(Page, Label) {
  const Tab = await Page.evaluate((Label) => {
    const Hit = [...document.querySelectorAll("[data-tab-page] [aria-label], [data-tab-page] [data-card]")].find(
      (Each) => Each.getAttribute("aria-label") === Label || Each.dataset.card === Label,
    );
    const Holder = Hit?.closest("[data-tab-page]");
    return Holder?.hidden ? Holder.dataset.tabPage : null;
  }, Label);
  if (Tab) await PickTab(Page, Tab);
}

// Follow-up 65: a light's reference sheet is split over its pages (the summary on Overview, the light's source and controls on
// Source). ReferenceSheet(Page) reads like one frame locator (locator, getByRole, getByLabel, first, nth, filter, then any action): each
// action finds the slice that holds the target, turns to its page and runs there. Sheets with no slices (Wind) use their one frame.
const SheetSlices = ['[data-reference-slice="summary"] iframe', '[data-reference-slice="details"] iframe', 'iframe[title^="Reference inspector"]'];
const SheetChains = ["locator", "getByRole", "getByLabel", "getByText", "first", "last", "nth", "filter"];
export function ReferenceSheet(Page, Steps = []) {
  const Resolve = async () => {
    for (const Slice of SheetSlices) {
      if (!(await Page.locator(Slice).count())) continue;
      // Role and label locators skip shut pages, so the slice's page is opened before they look.
      if (Steps.some(([Key]) => Key.startsWith("getBy"))) await Reveal(Slice);
      let Target = Page.frameLocator(Slice).first();
      for (const [Key, Arguments] of Steps) Target = Target[Key](...Arguments);
      if (await Target.count()) return { Slice, Target };
    }
    return null;
  };
  const Reveal = async (Slice) => {
    const Tab = await Page.locator(Slice).first().evaluate((Each) => Each.closest("[data-tab-page]")?.dataset.tabPage || null);
    if (Tab) await PickTab(Page, Tab);
  };
  return new Proxy(
    {},
    {
      get(_, Key) {
        if (SheetChains.includes(Key)) return (...Arguments) => ReferenceSheet(Page, [...Steps, [Key, Arguments]]);
        if (Key === "then") return undefined;
        return async (...Arguments) => {
          let Found = await Resolve();
          if (Key === "waitFor") {
            const Until = Date.now() + 12000;
            while (!Found && Date.now() < Until) {
              await Page.waitForTimeout(100);
              Found = await Resolve();
            }
          }
          if (!Found) {
            if (Key === "count") return 0;
            throw new Error("ReferenceSheet: nothing matches " + JSON.stringify(Steps));
          }
          if (Key !== "count") await Reveal(Found.Slice);
          return Found.Target[Key](...Arguments);
        };
      },
    },
  );
}
