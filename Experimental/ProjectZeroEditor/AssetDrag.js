// Follow-up 68: dragging assets out of the Content Browser. Materials and Images carry their content in the drag (the drop target
// copies what it needs), and the drag's type names the asset category so targets can light up while the drag is still over them.
const Prefix = "application/frontier-asset-";

export function AssetDragStart(Event, Asset) {
  const Category = String(Asset.Kind || "").toLowerCase();
  const Carried = { Id: Asset.Id, Name: Asset.Name, Kind: Asset.Kind, Material: Asset.Material, Data: Asset.Kind === "Images" ? Asset.Data : undefined };
  Event.dataTransfer.setData(Prefix + Category, JSON.stringify(Carried));
  Event.dataTransfer.setData("text/plain", Asset.Name || "");
  Event.dataTransfer.effectAllowed = "copy";
}

export const IsAssetDrag = (Event, Kinds) =>
  [...(Event.dataTransfer?.types || [])].some((Type) => Kinds.some((Kind) => Type === Prefix + Kind.toLowerCase()));

export function ReadAssetDrag(Event, Kinds) {
  for (const Kind of Kinds) {
    const Text = Event.dataTransfer?.getData(Prefix + Kind.toLowerCase());
    if (!Text) continue;
    try {
      return JSON.parse(Text);
    } catch {
      return null;
    }
  }
  return null;
}

// Props for a drop target: it shows data-asset-drop-over while a matching asset is over it and calls Drop(asset) on release.
export function AssetDropProps(Kinds, Drop) {
  const Over = (Event) => {
    if (!IsAssetDrag(Event, Kinds)) return;
    Event.preventDefault();
    Event.stopPropagation();
    Event.dataTransfer.dropEffect = "copy";
    Event.currentTarget.setAttribute("data-asset-drop-over", "true");
  };
  return {
    "data-asset-drop": Kinds.join(" "),
    onDragEnter: Over,
    onDragOver: Over,
    onDragLeave: (Event) => {
      if (Event.currentTarget.contains(Event.relatedTarget)) return;
      Event.currentTarget.removeAttribute("data-asset-drop-over");
    },
    onDrop: (Event) => {
      if (!IsAssetDrag(Event, Kinds)) return;
      Event.preventDefault();
      Event.stopPropagation();
      Event.currentTarget.removeAttribute("data-asset-drop-over");
      const Asset = ReadAssetDrag(Event, Kinds);
      if (Asset) Drop(Asset);
    },
  };
}
