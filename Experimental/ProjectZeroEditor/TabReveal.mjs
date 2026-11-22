// For the checks: opens the lettered inspector tab (InspectorTabs.jsx) holding a control, when that page is shut.
export async function OpenTabOf(Target) {
  const Tab = await Target.evaluate((Each) => {
    const Holder = Each.closest("[data-tab-page]");
    return Holder?.hidden ? Holder.dataset.tabPage : null;
  });
  if (!Tab) return;
  await Target.page().locator(`[data-tab-for="${Tab}"]`).click();
  await Target.page().locator(`[data-tab-page="${Tab}"]`).waitFor();
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
  if (!Tab) return;
  await Page.locator(`[data-tab-for="${Tab}"]`).click();
  await Page.locator(`[data-tab-page="${Tab}"]`).waitFor();
}
