//============================================================================================================================================
//                                                             PATTERNWORKSPACE.JSX
//============================================================================================================================================
// 🧩 The ShaderEditor's Pattern tab (Follow-up 71): the Texture Studio's Pattern studio, laid out again for the ShaderEditor window.
// Everything it does comes from the Texture Studio's own pattern model (usePatternEditorModel in TextureStudio/src/PatternEditor.jsx):
// the vector canvas and its tools, layers, groups, masks, booleans, arrays, text, SVG and image imports, the 100-card library, the layout
// generator, textile and rug controls, the repeat and the exports. Only the arrangement is new:
//   • Three docks side by side, each with the editor's document tabs (Follow-up 73): LayerStack | Viewport | Inspector. The side docks
//     close from their tab and come back from the + on the Viewport tab strip.
//   • The left dock shows the LayerStack or the Library, never both. The LayerStack is drawn as the editor's Outliner
//     (ArtworkOutliner.jsx): groups and folders fold, each row has its eye and lock, rows drag to reorder.
//   • The Viewport dock carries its own header, as the editor's viewport does: the pattern's name and save status, Design | Repeat, undo,
//     redo and a ⋯ menu (new, open, save, shortcuts); then Apply to material, every drawing tool in families, the grid, snapping, the
//     canvas options and the canvas zoom. The canvas sits under it, with theme-coloured rulers and grid; Repeat shows the tile repeating.
//   • The Inspector dock turns pages: Shape (what is selected, or the style of the next shape), Surface, Repeat and Export.
// Apply to material writes the pattern into the bound material's colour, roughness and metalness (SurfaceTextures.js).

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Undo2, Redo2, Layers3, MoreHorizontal, Upload, Spline, Lock,
  ArrowUp, ArrowDown, Download, FilePlus2, FolderOpen, Save, CircleHelp, X, Grid3X3, Magnet, SlidersHorizontal, Code2, Wand2,
  LayoutGrid, Search, FolderTree, Copy, Trash2, Group, BringToFront, SendToBack, FlipHorizontal2, FlipVertical2, Orbit, Paintbrush,
} from "lucide-react";
import ArtworkOutliner, { OutlinerHeading, FolderPicture, GroupPicture } from "./ArtworkOutliner.jsx";
import { DockTabs, ViewportHeader } from "./SurfaceDocks.jsx";
import { QuickMenu, useQuickMenu, MenuTabs, MenuLabel, MenuChips } from "./QuickMenu.jsx";
import { PatternEnclosureContains } from "../TextureStudio/src/PatternOrganization.js";
import { usePatternEditorModel } from "../TextureStudio/src/PatternEditor.jsx";
import ShapeEditorCanvas from "../TextureStudio/src/ShapeEditorCanvas.jsx";
import { ShapeSelectionActions, shapeTools } from "../TextureStudio/src/ShapeEditorToolbar.jsx";
import PatternColourControls, { PatternPropertyCard } from "../TextureStudio/src/PatternColourControls.jsx";
import PatternSurfaceChannelControls from "../TextureStudio/src/PatternSurfaceChannelControls.jsx";
import PatternOrganizationControls from "../TextureStudio/src/PatternOrganizationControls.jsx";
import PatternTextControls from "../TextureStudio/src/PatternTextControls.jsx";
import PatternTextileTools from "../TextureStudio/src/PatternTextileTools.jsx";
import RugCompositionControls from "../TextureStudio/src/RugCompositionControls.jsx";
import PatternLayerThumbnail from "../TextureStudio/src/PatternLayerThumbnail.jsx";
import ArtworkArrayControls from "../TextureStudio/src/ArtworkArrayControls.jsx";
import ArtworkMaskCanvas from "../TextureStudio/src/ArtworkMaskCanvas.jsx";
import ArtworkMaskStackRow from "../TextureStudio/src/ArtworkMaskStackRow.jsx";
import ArtworkMaskControls from "../TextureStudio/src/ArtworkMaskControls.jsx";
import { ArtworkSelectionMask } from "../TextureStudio/src/ArtworkSelectionMask.js";
import SVGSourceEditor from "../TextureStudio/src/SVGSourceEditor.jsx";
import { layerWorldContours } from "../TextureStudio/src/vectorEditorGeometry.js";
import { expandPatternSelection, convertPatternLayerToPath, svgPathNodes } from "../TextureStudio/src/shapeEditorGeometry.js";
import { patternStarter, patternStarterCatalog, patternSVG, patternFinishes, generatePatternLayout, validatePattern } from "../TextureStudio/src/patternDocument.js";
import { textilePalettes, replacePatternColor } from "../TextureStudio/src/patternLibrary.js";
import { rebuildCollectionFade } from "../TextureStudio/src/patternCollections.js";
import { reflectPatternLayer, radialPatternLayers } from "../TextureStudio/src/patternTransforms.js";
import { leatherSourceSVG } from "../TextureStudio/src/leatherSource.js";
import { savePatternDraft, PATTERN_DRAFT_KEY } from "../TextureStudio/src/patternDraft.js";
import { PageStrip, PageTurn, PageLook } from "./PageCarousel.jsx";
// The Texture Studio's fonts and its studio theme (scoped to these workspaces by Build.mjs), then this layout over them.
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "../TextureStudio/src/styles.css";
import "../TextureStudio/src/studioTheme.css";
import "../TextureStudio/src/artworkAuthoring.css";
import "./SurfaceWorkspaces.css";

const LibraryGroups = ["All patterns", ...new Set(patternStarterCatalog.map((Entry) => Entry.group))];
const UnpalettedGroups = ["Fabric weaves", "Stitch patterns", "Islamic geometry", "African traditional"];
// The top toolbar's families; "~" marks the tools that fold into More when the workspace is narrow.
const ToolFamilies = [
  ["Select", ["move", "node"]],
  ["Shapes", ["rect", "ellipse", "~line", "~triangle", "~diamond", "polygon", "star", "~arc"]],
  ["Paths", ["pen", "~curve", "pencil"]],
  ["Marks", ["text", "~eyedropper", "hand"]],
];
const Shortcuts = [
  ["Select / Points", "V / A"],
  ["Rectangle / Ellipse", "R / O"],
  ["Pen / Curve / Freehand", "P / U / B"],
  ["Break tangent / Reposition", "Alt / Space-drag"],
  ["Join open paths", "Ctrl/⌘ J"],
  ["Pan / Fit", "Space / 0"],
  ["Multi-select", "Shift-click"],
  ["Duplicate / Group", "Ctrl/⌘ D / G"],
  ["Copy / Paste", "Ctrl/⌘ C / V"],
  ["Undo / Redo", "Ctrl/⌘ Z / Shift Z"],
  ["Nudge / Fast nudge", "Arrow / Shift Arrow"],
  ["Finish / Cancel path", "Enter / Esc"],
];
// The quick menu's tool grid: the tools used most, two rows of four.
const MenuTools = ["move", "node", "pen", "pencil", "rect", "ellipse", "text", "hand"];
const Pages = [
  { Id: "shape", Label: "Shape" },
  { Id: "surface", Label: "Surface" },
  { Id: "repeat", Label: "Repeat" },
  { Id: "export", Label: "Export" },
];
function SaveFile(Text, Name, Type) {
  const Link = document.createElement("a"), Url = URL.createObjectURL(new Blob([Text], { type: Type }));
  Link.href = Url;
  Link.download = Name;
  Link.click();
  setTimeout(() => URL.revokeObjectURL(Url), 1000);
}

// A library card: the starter drawn once, only while its page is shown.
const StarterCard = React.memo(function StarterCard({ Name, Palette, Note, Choose }) {
  const Picture = useMemo(() => "data:image/svg+xml," + encodeURIComponent(patternSVG(patternStarter(Name, Palette), "preview")), [Name, Palette]);
  return (
    <button className="sfw-starter" title={Note || Name} onClick={Choose}>
      <img src={Picture} alt="" loading="lazy" decoding="async" />
      <span>{Name}</span>
    </button>
  );
});

// A small menu that opens from a button and closes on an outside press or Esc.
export function Popover({ Label, Glyph, Caption, className = "", Align = "start", Disabled, children }) {
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
    <div className={"sfw-popover " + className} ref={Anchor}>
      <button type="button" className="sfw-icon-button" aria-label={Label} title={Label} aria-expanded={Open} disabled={Disabled} onClick={() => Show(!Open)}>
        {Glyph}
        {Caption && <span>{Caption}</span>}
      </button>
      {Open && (
        <div className={"sfw-menu sfw-menu-" + Align} role="menu" aria-label={Label} onClick={(Event) => Event.target.closest("[data-closes]") && Show(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// The pattern being edited outlives the tab: turning to Material or Stamp and back (or binding another object) reopens it.
let KeptPattern = null;

export default function PatternWorkspace({ Owner, Apply, OpenStudio }) {
  const Deselect = useRef(() => {});
  const Model = usePatternEditorModel({ initial: KeptPattern || undefined, onClose: () => Deselect.current() });
  const {
    doc, docRef, selected, setSelected, canUndo, canRedo, canvasRef, layerDrag, MaskIdentity, ConfigureMaskIdentity, EnclosureScope,
    ConfigureEnclosureScope, LayerQuery, SetLayerQuery, LayerFilter, SetLayerFilter, LayerMatches, SelectionRevision, selection, l,
    MaskActive, editIds, tool, setTool, pathState, setPathPanelTarget, showGrid, setShowGrid, smartGuides, setSmartGuides, recoverable,
    setRecoverable, draftStatus, exportSize, setExportSize, drawingStyle, setDrawingStyle, snapping, setSnapping, fontsReady,
    textDefaults, textFocus, textError, svgSource, setSVGSource, changeText, createText, editText, openSVGSource, embedSVG,
    sampleAppearance, multiBounds, bulkGeometry, commit, update, layer, ChangeDrawingSource, undo, redo, saveDocument, changeTool,
    persistWorkingDraft, selectLayer, action, keyDown, exportPNG, grid, setGrid, aspect, setAspect, ring, setRing, collectionFilter,
    setCollectionFilter, librarySearch, setLibrarySearch, libraryPalette, setLibraryPalette, libraryMatches, libraryPages, pageIndex,
    setLibraryPage, generator, setGenerator, busy, input, svgInput, jsonInput, add, preview, importFile, shift, field, error, setError,
    previewDocument, cancelDocument, setMode, setDraftStatus,
  } = Model;
  // Escape outside a path or a text field clears the selection (the Texture Studio closes the studio there instead).
  Deselect.current = () => setSelected([]);
  useEffect(() => {
    KeptPattern = doc;
  }, [doc]);
  const [Rail, ShowRail] = useState(doc.layers.length ? "layers" : "library");
  const [View, ShowView] = useState("design");
  const [FoldedEnclosures, FoldEnclosures] = useState(() => new Set());
  const [Shut, ShutDocks] = useState({});
  const [ZoomSlot, PlaceZoomSlot] = useState(null);
  const [Page, TurnTo] = useState(0);
  const Motion = PageTurn(Page);
  const [ShortcutsOpen, ShowShortcuts] = useState(false);
  const [Applying, Busy] = useState(""), [Applied, Report] = useState("");
  const [TileSize, SizeTiles] = useState(160);
  const PatternRoot = useRef(null);
  const Finish = () => !(canvasRef.current && !canvasRef.current.prepareExport());
  const Turn = (At) => {
    Motion.Turn(At);
    TurnTo(At);
  };
  // The canvas only reports a pending path once it exists; turning away from Design keeps the path open but stops the interaction.
  const Show = (Next) => {
    if (Next !== "design") {
      if (!Finish()) return;
      canvasRef.current?.cancelInteraction();
    }
    ConfigureMaskIdentity(null);
    ShowView(Next);
  };
  useEffect(() => {
    if (MaskActive) ShowView("design");
  }, [MaskActive]);
  const Construction = patternStarterCatalog.find((Entry) => Entry.name === doc.name)?.description;
  const Selection = selected.length > 1 ? "many" : l ? "one" : "none";

  async function ApplyToMaterial() {
    if (!Finish()) return false;
    canvasRef.current?.cancelInteraction();
    try {
      savePatternDraft(docRef.current);
    } catch {}
    Busy("Applying…");
    try {
      const Document = validatePattern(docRef.current);
      const Outcome = await Apply(Document, {
        colour: patternSVG(Document, "color"),
        roughness: patternSVG(Document, "roughness"),
        metallic: patternSVG(Document, "metalness"),
      });
      Report(Outcome || "Applied to the material");
      setTimeout(() => Report(""), 3200);
      return true;
    } catch (Failure) {
      setError(Failure.message);
      return false;
    } finally {
      Busy("");
    }
  }

  // ── Left rail: the layer stack, drawn as the editor's Outliner (ArtworkOutliner.jsx) ───────────────────────────────────────────────
  // Groups and folders (doc.Enclosures) become disclosure rows; each sits where its topmost layer sits, holding all its layers.
  const SetLayers = (Change) => commit({ ...doc, layers: doc.layers.map((Layer, At) => Change(Layer, At)) });
  const ArtworkRows = (() => {
    const Enclosures = doc.Enclosures || [], Root = { Members: [] }, Branches = new Map();
    const BranchOf = (Token, Guard = 0) => {
      if (Branches.has(Token)) return Branches.get(Token);
      const Enclosure = Enclosures.find((Each) => Each.Token === Token);
      if (!Enclosure || Guard > 12) return Root;
      const Holder = Enclosure.EnclosureToken ? BranchOf(Enclosure.EnclosureToken, Guard + 1) : Root;
      const Branch = { Enclosure, Members: [] };
      Holder.Members.push(Branch);
      Branches.set(Token, Branch);
      return Branch;
    };
    for (const Match of [...LayerMatches].reverse()) (Match.Layer.EnclosureToken ? BranchOf(Match.Layer.EnclosureToken) : Root).Members.push(Match);
    const Rows = [];
    const LayerRow = ({ Layer: P, Index: I }, Depth) => ({
      Id: P.id,
      Name: P.name,
      Label: P.name,
      Detail: `${P.kind} · ${Math.round((P.opacity ?? 1) * 100)}%${P.mask ? " · masked" : ""}`,
      Picture: <PatternLayerThumbnail layer={P} size={24} FallbackIcon={shapeTools.find(([Shape]) => Shape === P.kind)?.[3] || Layers3} />,
      Depth,
      Chosen: selected.includes(I) && !MaskActive,
      Hidden: !P.visible,
      Locked: P.locked,
      Pick: (Event) => selectLayer(I, Event),
      Show: () => SetLayers((Q, J) => (J === I ? { ...Q, visible: !Q.visible } : Q)),
      Lock: () => SetLayers((Q, J) => (J === I ? { ...Q, locked: !Q.locked } : Q)),
      Below: P.mask ? (
        <ArtworkMaskStackRow
          Mask={P.mask}
          Name={P.name}
          Selected={MaskActive && MaskIdentity === P.id}
          Locked={P.locked}
          OnSelect={() => {
            if (canvasRef.current?.hasPendingPath() && !canvasRef.current.prepareExport()) return;
            setSelected([I]);
            ConfigureMaskIdentity(P.id);
            setMode("design");
          }}
          OnChange={(Mask) => commit({ ...docRef.current, layers: docRef.current.layers.map((Entry) => (Entry.id === P.id ? { ...Entry, mask: Mask } : Entry)) })}
        />
      ) : null,
      Drag: {
        draggable: !P.locked,
        onDragStart: (Event) => {
          layerDrag.current = selected.includes(I) ? selected.filter((J) => !doc.layers[J].locked) : expandPatternSelection(doc, I);
          Event.dataTransfer.effectAllowed = "move";
          Event.dataTransfer.setData("text/plain", String(I));
        },
        onDragOver: (Event) => {
          if (layerDrag.current?.length) {
            Event.preventDefault();
            Event.dataTransfer.dropEffect = "move";
          }
        },
        onDrop: (Event) => {
          Event.preventDefault();
          const Moving = layerDrag.current;
          layerDrag.current = null;
          if (!Moving?.length || Moving.includes(I)) return;
          const Chosen = new Set(Moving),
            Entries = doc.layers.map((Layer, At) => ({ Layer, At })),
            Kept = Entries.filter((Entry) => !Chosen.has(Entry.At)),
            Moved = Entries.filter((Entry) => Chosen.has(Entry.At)),
            Into = Kept.findIndex((Entry) => Entry.At === I) + 1;
          Kept.splice(Into, 0, ...Moved);
          commit({ ...doc, layers: Kept.map((Entry) => Entry.Layer) }, { selected: Kept.flatMap((Entry, At) => (Chosen.has(Entry.At) ? [At] : [])) });
        },
        onDragEnd: () => (layerDrag.current = null),
      },
    });
    const EnclosureRow = ({ Enclosure }, Depth) => {
      const Within = doc.layers.flatMap((Layer, At) => (PatternEnclosureContains(doc, Enclosure.Token, Layer.EnclosureToken) ? [At] : []));
      const Unlocked = Within.filter((At) => !doc.layers[At].locked);
      const AllLocked = !!Within.length && !Unlocked.length, AnyShown = Within.some((At) => doc.layers[At].visible);
      return {
        Id: "enclosure-" + Enclosure.Token,
        Name: Enclosure.Caption,
        Label: /group|folder/i.test(Enclosure.Caption) ? Enclosure.Caption : `${Enclosure.Category === "folder" ? "Folder" : "Group"} ${Enclosure.Caption}`,
        Detail: `${Enclosure.Category === "folder" ? "Folder" : "Group"} · ${Within.length} layer${Within.length === 1 ? "" : "s"}`,
        Picture: Enclosure.Category === "folder" ? <FolderPicture /> : <GroupPicture />,
        Depth,
        Folder: true,
        Folded: FoldedEnclosures.has(Enclosure.Token),
        Fold: () =>
          FoldEnclosures((Previous) => {
            const Next = new Set(Previous);
            Next.has(Enclosure.Token) ? Next.delete(Enclosure.Token) : Next.add(Enclosure.Token);
            return Next;
          }),
        Chosen: !MaskActive && !!Within.length && Within.every((At) => selected.includes(At)),
        Picked: !MaskActive && Within.some((At) => selected.includes(At)),
        Hidden: !!Within.length && !AnyShown,
        Locked: AllLocked,
        Pick: (Event) => {
          ConfigureMaskIdentity(null);
          setSelected(Event.shiftKey || Event.ctrlKey || Event.metaKey ? [...new Set([...selected, ...Within])] : Within);
        },
        Show: Within.length ? () => SetLayers((Q, J) => (Within.includes(J) && (!AnyShown || !Q.locked) ? { ...Q, visible: !AnyShown } : Q)) : undefined,
        Lock: Within.length ? () => SetLayers((Q, J) => (Within.includes(J) ? { ...Q, locked: !AllLocked } : Q)) : undefined,
      };
    };
    const Walk = (Holder, Depth) => {
      for (const Member of Holder.Members)
        if (Member.Enclosure) {
          Rows.push(EnclosureRow(Member, Depth));
          if (!FoldedEnclosures.has(Member.Enclosure.Token)) Walk(Member, Depth + 1);
        } else Rows.push(LayerRow(Member, Depth));
    };
    Walk(Root, 0);
    return Rows;
  })();
  const Layers = (
    <ArtworkOutliner
      Title="Layers"
      Detail={`${doc.layers.length}/64 · ${doc.name}`}
      Label="Pattern layers"
      Actions={
        <>
          <Popover Label="Add pattern layer" Glyph={<Plus size={15} />} Align="side" Disabled={doc.layers.length >= 64}>
            <span className="sfw-menu-title">Shapes</span>
            <div className="sfw-menu-grid">
              {shapeTools
                .filter(([Shape]) => ["rect", "ellipse", "triangle", "diamond", "polygon", "star"].includes(Shape))
                .map(([Shape, Caption, , Glyph]) => (
                  <button key={Shape} data-closes onClick={() => add(Shape) && (SetLayerQuery(""), SetLayerFilter("all"))}>
                    <Glyph size={14} />
                    {Caption.replace(" tool", "")}
                  </button>
                ))}
            </div>
            <span className="sfw-menu-title">Editable motifs</span>
            <div className="sfw-menu-grid">
              {[
                ["Rosette", "star", { starPoints: 12, innerRadius: 0.65, width: 128, height: 128 }],
                ["Ribbon", "rect", { width: 240, height: 48, cornerRadius: 20, rotation: -30 }],
                ["Ring", "ellipse", { width: 140, height: 140, fillEnabled: false, strokeWidth: 8 }],
                ["Flower", "flower", {}],
                ["Arch", "path", { path: "M10 80 Q50 0 90 80", strokeWidth: 3 }],
              ].map(([Caption, Shape, Preset]) => (
                <button key={Caption} data-closes onClick={() => add(Shape, { ...Preset, name: Caption }) && (SetLayerQuery(""), SetLayerFilter("all"))}>
                  {Caption}
                </button>
              ))}
            </div>
            <span className="sfw-menu-title">Import</span>
            <button data-closes disabled={busy} onClick={() => input.current.click()}>
              <Upload size={13} /> Image (PNG, JPEG, WebP)
            </button>
            <button data-closes disabled={busy} onClick={() => svgInput.current.click()}>
              <Upload size={13} /> SVG file
            </button>
            <button data-closes onClick={() => openSVGSource()}>
              <Code2 size={13} /> Paste SVG source
            </button>
          </Popover>
          <Popover Label="Groups and folders" Glyph={<FolderTree size={15} />} Align="side" className="sfw-popover-wide">
            <span className="sfw-menu-title">Groups & folders</span>
            <PatternOrganizationControls Document={doc} Selection={selected} OnFinalize={commit} OnSelect={setSelected} OnError={setError} Scope={EnclosureScope} OnScope={ConfigureEnclosureScope} />
          </Popover>
        </>
      }
      Visible={doc.layers.filter((Layer) => Layer.visible).length}
      Hidden={doc.layers.filter((Layer) => !Layer.visible).length}
      ShowAll={() => SetLayers((Layer) => (Layer.visible ? Layer : { ...Layer, visible: true }))}
      HideAll={() => SetLayers((Layer) => (Layer.locked || !Layer.visible ? Layer : { ...Layer, visible: false }))}
      Query={LayerQuery}
      Search={SetLayerQuery}
      Filter={LayerFilter}
      Sift={SetLayerFilter}
      Rows={ArtworkRows}
      Empty={
        doc.layers.length ? (
          <>
            No matching layers.{" "}
            <button className="sfw-link" onClick={() => (SetLayerQuery(""), SetLayerFilter("all"))}>
              Clear filters
            </button>
          </>
        ) : (
          "Draw a shape, add one with +, or start from the Library."
        )
      }
      Footer={
        <>
          <span>
            <small>LAYERS</small>
            <b>{doc.layers.length} / 64</b>
          </span>
          <span>
            <small>CHOSEN</small>
            <b>{selected.length}</b>
          </span>
          <span>
            <small>ORDER</small>
            <b>Top draws in front · drag</b>
          </span>
        </>
      }
    />
  );
  const Library = (
    <div className="sfw-rail-body">
      <div className="sfw-rail-tools">
        <select aria-label="Pattern collection" value={collectionFilter} onChange={(Event) => setCollectionFilter(Event.target.value)}>
          {LibraryGroups.map((Group) => (
            <option key={Group}>{Group}</option>
          ))}
        </select>
        {!UnpalettedGroups.includes(collectionFilter) && (
          <select aria-label="Textile family colorway" title="Print palette for the printed families" value={libraryPalette} onChange={(Event) => setLibraryPalette(Event.target.value)}>
            {Object.keys(textilePalettes).map((Palette) => (
              <option key={Palette}>{Palette}</option>
            ))}
          </select>
        )}
      </div>
      <label className="sfw-search wide">
        <Search size={13} />
        <input type="search" aria-label="Search patterns" placeholder="Search weaves, stitches, checks…" value={librarySearch} onChange={(Event) => setLibrarySearch(Event.target.value)} />
      </label>
      <div className="sfw-starters" key={`${collectionFilter}-${libraryPalette}-${librarySearch}-${pageIndex}`}>
        {libraryMatches.slice(pageIndex * 24, pageIndex * 24 + 24).map(({ name, description }) => (
          <StarterCard
            key={name}
            Name={name}
            Palette={libraryPalette}
            Note={description}
            Choose={() => {
              canvasRef.current?.cancelInteraction();
              commit(patternStarter(name, libraryPalette));
              setTool("move");
              Model.setSelection(0);
              ShowView("design");
            }}
          />
        ))}
      </div>
      {!libraryMatches.length && <p className="sfw-hint">No matches. Try another collection or search.</p>}
      <div className="sfw-paging">
        <button aria-label="Previous pattern page" disabled={pageIndex === 0} onClick={() => setLibraryPage(pageIndex - 1)}>
          ‹
        </button>
        <span aria-live="polite">
          {libraryMatches.length} patterns · page {pageIndex + 1} / {libraryPages}
        </span>
        <button aria-label="Next pattern page" disabled={pageIndex + 1 >= libraryPages} onClick={() => setLibraryPage(pageIndex + 1)}>
          ›
        </button>
      </div>
      {["Islamic geometry", "African traditional"].includes(collectionFilter) && <p className="sfw-hint">Original vector studies inspired by named traditions, not historical reproductions.</p>}
      <details className="sfw-fold">
        <summary>
          <Wand2 size={13} /> Generate a layout
        </summary>
        <div className="sfw-fields">
          <label>
            Style
            <select aria-label="Generator style" value={generator.style} onChange={(Event) => setGenerator({ ...generator, style: Event.target.value })}>
              <option value="geometric">Geometric motifs</option>
              <option value="floral">Scattered flowers</option>
            </select>
          </label>
          <div className="sfw-pair">
            <label>
              Seed
              <input aria-label="Layout seed" type="number" value={generator.seed} onChange={(Event) => setGenerator({ ...generator, seed: +Event.target.value })} />
            </label>
            <label>
              Motifs
              <input aria-label="Layout count" type="number" min="2" max="24" value={generator.count} onChange={(Event) => setGenerator({ ...generator, count: +Event.target.value })} />
            </label>
          </div>
          <button
            className="sfw-wide"
            onClick={() => {
              canvasRef.current?.cancelInteraction();
              commit(generatePatternLayout(generator));
              setSelected([0]);
              ShowView("design");
            }}
          >
            Generate pattern
          </button>
        </div>
      </details>
    </div>
  );

  // ── Inspector pages ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const CanBoolean =
    editIds.length >= 2 &&
    editIds.length <= 16 &&
    editIds.length === selected.length &&
    editIds.every((Index) => {
      const Shape = doc.layers[Index];
      const Contours = layerWorldContours(Shape);
      return !["image", "svg"].includes(Shape.kind) && (Shape.paint ? Shape.fillEnabled !== false : !(Shape.kind === "path" && Shape.strokeWidth)) && Contours.length > 0 && Contours.every((Contour) => Contour.closed);
    });
  const SelectionTools = !MaskActive && (
    <ShapeSelectionActions
      count={selected.length}
      hasGroup={editIds.some((Index) => doc.layers[Index].group)}
      canBoolean={CanBoolean}
      MaskNames={selected.length === 2 && editIds.length === 2 ? selected.map((Index) => doc.layers[Index].name) : null}
      OnUseMask={async (Offset) => {
        const Snapshot = docRef.current;
        try {
          const Target = selected[1 - Offset];
          const Next = await ArtworkSelectionMask(Snapshot, Target, selected[Offset]);
          if (docRef.current !== Snapshot || SelectionRevision.current !== selected) throw new Error("Selection changed; try again.");
          commit(Next, { selected: [Target] });
          ConfigureMaskIdentity(Snapshot.layers[Target].id);
        } catch (Failure) {
          setError(Failure.message);
        }
      }}
      onAction={action}
    />
  );
  const Paint = (Key, Patch) => {
    setDrawingStyle({ ...drawingStyle, ...Patch });
    if (selected.length > 1) commit({ ...doc, layers: doc.layers.map((P, I) => (editIds.includes(I) ? { ...P, paint: true, ...Patch } : P)) });
  };
  const DrawingStyle = (
    <section className="sfw-card">
      <header>
        <b>{Selection === "many" ? `${selected.length} shapes selected` : "Next shape"}</b>
        <small>{Selection === "many" ? "Shared edits reach every unlocked shape" : "The style new shapes are drawn with"}</small>
      </header>
      {Selection === "many" && (
        <label className="sfw-row">
          Opacity
          <input
            aria-label="Selection opacity"
            type="number"
            min="0"
            max="1"
            step=".05"
            placeholder="Mixed"
            value={selected.every((Index) => doc.layers[Index].opacity === doc.layers[selected[0]].opacity) ? doc.layers[selected[0]].opacity : ""}
            onChange={(Event) => {
              if (Event.target.value !== "") commit({ ...docRef.current, layers: docRef.current.layers.map((Shape, Index) => (editIds.includes(Index) ? { ...Shape, opacity: Math.max(0, Math.min(1, +Event.target.value)) } : Shape)) });
            }}
          />
        </label>
      )}
      {multiBounds && (
        <div className="sfw-grid4">
          {[
            ["x", "Selection X"],
            ["y", "Selection Y"],
            ["width", "Selection width"],
            ["height", "Selection height"],
          ].map(([Key, Caption]) => (
            <label key={Key}>
              {Caption.replace("Selection ", "")}
              <input aria-label={Caption} type="number" min={Key === "x" || Key === "y" ? -512 : 1} max="1024" value={+multiBounds[Key].toFixed(3)} onChange={(Event) => bulkGeometry(Key, +Event.target.value)} />
            </label>
          ))}
        </div>
      )}
      <PatternColourControls Caption="Drawing fill" ColourLabel="Drawing fill color" Source={drawingStyle.fillSource} Solid={drawingStyle.color} OnChange={(Source, Colour) => ChangeDrawingSource("fill", Source, Colour)} />
      <label className="sfw-switch">
        <input aria-label="Drawing fill enabled" type="checkbox" role="switch" checked={drawingStyle.fillEnabled} onChange={(Event) => Paint("fill", { fillEnabled: Event.target.checked })} />
        Fill
      </label>
      <PatternColourControls Caption="Drawing stroke" ColourLabel="Drawing stroke color" Source={drawingStyle.strokeSource} Solid={drawingStyle.stroke} OnChange={(Source, Colour) => ChangeDrawingSource("stroke", Source, Colour)} />
      <label className="sfw-row">
        Stroke width
        <input aria-label="Drawing stroke width" type="number" min="0" max="25" step="0.1" value={drawingStyle.strokeWidth} onChange={(Event) => Paint("stroke", { strokeWidth: Math.max(0, Math.min(25, +Event.target.value)) })} />
      </label>
      <label className="sfw-row">
        Finish
        <select
          aria-label="Drawing material finish"
          value={drawingStyle.finish}
          onChange={(Event) => {
            const F = patternFinishes[Event.target.value];
            const Patch = { finish: Event.target.value, roughness: F.roughness, metalness: F.metalness, relief: F.height };
            setDrawingStyle({ ...drawingStyle, ...Patch });
            if (selected.length > 1) commit({ ...doc, layers: doc.layers.map((P, I) => (editIds.includes(I) ? { ...P, ...Patch } : P)) });
          }}
        >
          {Object.entries(patternFinishes).map(([Key, F]) => (
            <option key={Key} value={Key}>
              {F.name}
            </option>
          ))}
        </select>
      </label>
      {tool === "polygon" && (
        <label className="sfw-row">
          Sides
          <input aria-label="Drawing polygon sides" type="number" min="3" max="24" value={drawingStyle.sides} onChange={(Event) => setDrawingStyle({ ...drawingStyle, sides: Math.max(3, Math.min(24, +Event.target.value)) })} />
        </label>
      )}
      {tool === "star" && (
        <div className="sfw-pair">
          <label>
            Points
            <input aria-label="Drawing star points" type="number" min="3" max="20" value={drawingStyle.starPoints} onChange={(Event) => setDrawingStyle({ ...drawingStyle, starPoints: Math.max(3, Math.min(20, +Event.target.value)) })} />
          </label>
          <label>
            Inner radius
            <input aria-label="Drawing star inner radius" type="number" min="0.05" max="0.95" step="0.05" value={drawingStyle.innerRadius} onChange={(Event) => setDrawingStyle({ ...drawingStyle, innerRadius: Math.max(0.05, Math.min(0.95, +Event.target.value)) })} />
          </label>
        </div>
      )}
    </section>
  );
  const Unlock = l?.locked && (
    <div className="sfw-locked">
      <Lock size={13} /> Locked layer
      <button onClick={() => commit({ ...doc, layers: doc.layers.map((P, I) => (I === selection ? { ...P, locked: false } : P)) })}>Unlock</button>
    </div>
  );
  const ChosenShape = l && (
    <>
      {Unlock}
      <fieldset disabled={!!l.locked} className="sfw-fieldset">
        <section className="sfw-card">
          <header>
            <input className="sfw-name" aria-label="Layer name" value={l.name} onChange={(Event) => layer({ name: Event.target.value })} />
            <small>{l.kind}</small>
          </header>
          <div className="sfw-grid3">
            {field("X", "x", -512, 1024)}
            {field("Y", "y", -512, 1024)}
            {field("Angle", "rotation", -360, 360)}
            {field("Width", "width", 1, 1024)}
            {field("Height", "height", 1, 1024)}
            {field("Opacity", "opacity", 0, 1, 0.05)}
          </div>
          <div className="sfw-chips">
            <button onClick={() => layer({ x: 256 })}>Centre X</button>
            <button onClick={() => layer({ y: 256 })}>Centre Y</button>
            <button aria-pressed={!!l.flipX} onClick={() => layer({ flipX: !l.flipX })}>
              Flip X
            </button>
            <button aria-pressed={!!l.flipY} onClick={() => layer({ flipY: !l.flipY })}>
              Flip Y
            </button>
            <button title="Bring forward" onClick={() => shift(1)}>
              <ArrowUp size={12} /> Forward
            </button>
            <button title="Send backward" onClick={() => shift(-1)}>
              <ArrowDown size={12} /> Back
            </button>
          </div>
        </section>
        {["image", "svg"].includes(l.kind) ? (
          <section className="sfw-card">
            <p className="sfw-hint">Original image and SVG colours are kept. Edit the SVG source to change its palette.</p>
            {l.kind === "svg" && (
              <button className="sfw-wide" onClick={() => openSVGSource(selection)}>
                <Spline size={13} /> Edit SVG source
              </button>
            )}
          </section>
        ) : (
          <>
            <PatternPropertyCard Caption="Fill">
              <PatternColourControls
                key={`fill-${l.id}`}
                Caption="Motif fill"
                ColourLabel="Motif color"
                Source={l.fillSource}
                Solid={l.color}
                OnChange={(Source, Colour) => {
                  if (!Source && (doc.stitch || doc.weave || doc.library)) {
                    const Next = replacePatternColor(docRef.current, l.color, Colour);
                    Next.layers = Next.layers.map((Shape) => (Shape.id === l.id ? { ...Shape, fillSource: undefined } : Shape));
                    commit(Next);
                  } else layer({ fillSource: Source, color: Colour });
                }}
              />
              <label className="sfw-switch">
                <input type="checkbox" role="switch" aria-label="Motif fill enabled" checked={l.paint ? l.fillEnabled : !(l.kind === "path" && l.strokeWidth)} onChange={(Event) => layer({ paint: true, fillEnabled: Event.target.checked, stroke: l.paint ? l.stroke : l.color })} />
                Fill
              </label>
            </PatternPropertyCard>
            <PatternPropertyCard Caption="Stroke & geometry">
              <PatternColourControls
                key={`stroke-${l.id}`}
                Caption="Motif stroke"
                ColourLabel="Motif stroke color"
                Source={l.strokeSource}
                Solid={l.paint ? l.stroke : l.color}
                OnChange={(Source, Colour) => layer({ paint: true, strokeSource: Source, stroke: Colour, fillEnabled: l.paint ? l.fillEnabled : !(l.kind === "path" && l.strokeWidth), strokeWidth: l.strokeWidth || 1 })}
              />
              {l.paint && (
                <div className="sfw-pair">
                  <label>
                    Line cap
                    <select aria-label="Motif line cap" value={l.strokeLinecap || "round"} onChange={(Event) => layer({ strokeLinecap: Event.target.value })}>
                      {["round", "butt", "square"].map((Each) => (
                        <option key={Each}>{Each}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Line join
                    <select aria-label="Motif line join" value={l.strokeLinejoin || "round"} onChange={(Event) => layer({ strokeLinejoin: Event.target.value })}>
                      {["round", "miter", "bevel"].map((Each) => (
                        <option key={Each}>{Each}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <div className="sfw-grid2">
                {field("Stroke width", "strokeWidth", 0, 25, 0.1)}
                {l.kind === "rect" && field("Corner radius", "cornerRadius", 0, 50)}
                {l.kind === "polygon" && field("Polygon sides", "sides", 3, 24)}
                {l.kind === "star" && field("Star points", "starPoints", 3, 20)}
                {l.kind === "star" && field("Inner radius", "innerRadius", 0.05, 0.95, 0.05)}
                {l.kind === "arc" && field("Arc start angle", "arcStart", -360, 360)}
                {l.kind === "arc" && field("Arc sweep angle", "arcSweep", -359.99, 359.99, 0.1)}
              </div>
              {l.kind === "arc" && (
                <label className="sfw-row">
                  Arc closure
                  <select aria-label="Arc closure" value={l.arcClosure} onChange={(Event) => layer({ arcClosure: Event.target.value, fillEnabled: Event.target.value !== "open" })}>
                    <option value="open">Open arc</option>
                    <option value="chord">Closed chord</option>
                    <option value="pie">Pie / sector</option>
                  </select>
                </label>
              )}
              {l.nodes && (
                <label className="sfw-switch">
                  <input type="checkbox" role="switch" aria-label="Close motif path" checked={l.closed} onChange={(Event) => layer({ closed: Event.target.checked })} />
                  Closed path
                </label>
              )}
              <button
                className="sfw-wide"
                onClick={() => {
                  try {
                    layer(convertPatternLayerToPath(l));
                    setTool("node");
                    ShowView("design");
                  } catch (Failure) {
                    setError(Failure.message);
                  }
                }}
              >
                <Spline size={13} /> {l.nodes ? "Edit path points" : "Convert to editable path"}
              </button>
              {l.kind === "path" && (
                <label className="sfw-column">
                  SVG path · local 0–100
                  <textarea
                    aria-label="SVG path"
                    value={l.path}
                    onChange={(Event) => {
                      const Contour = svgPathNodes(Event.target.value);
                      layer({ path: Event.target.value, nodes: Contour?.nodes || undefined, closed: Contour?.closed || false });
                    }}
                  />
                </label>
              )}
            </PatternPropertyCard>
          </>
        )}
        <details className="sfw-fold">
          <summary>Reflect & ring</summary>
          <div className="sfw-chips">
            <button onClick={() => add(l.kind, reflectPatternLayer(l, "x"))}>Reflected copy X</button>
            <button onClick={() => add(l.kind, reflectPatternLayer(l, "y"))}>Reflected copy Y</button>
          </div>
          <div className="sfw-pair">
            <label>
              Copies
              <input aria-label="Radial copies" type="number" min="2" max="12" value={ring.count} onChange={(Event) => setRing({ ...ring, count: +Event.target.value })} />
            </label>
            <label>
              Radius
              <input aria-label="Radial radius" type="number" min="0" max="256" value={ring.radius} onChange={(Event) => setRing({ ...ring, radius: +Event.target.value })} />
            </label>
          </div>
          <button className="sfw-wide" onClick={() => commit({ ...doc, layers: doc.layers.flatMap((P, I) => (I === selection ? radialPatternLayers(P, ring.count, ring.radius) : [P])) })}>
            Arrange in a ring
          </button>
        </details>
      </fieldset>
    </>
  );
  const ShapePage = (
    <>
      {SelectionTools}
      <div className="se-path-panel sfw-path-panel" ref={setPathPanelTarget} />
      {(tool === "text" || l?.kind === "text") && (
        <PatternTextControls
          text={l?.kind === "text" ? l.text : textDefaults}
          onChange={changeText}
          ready={fontsReady}
          selected={l?.kind === "text"}
          disabled={!!l?.locked}
          error={textError}
          focusToken={textFocus}
          onOutline={() => {
            layer(convertPatternLayerToPath(l));
            setTool("move");
          }}
        />
      )}
      {Selection === "one" && ["move", "node", "hand"].includes(tool) ? ChosenShape : DrawingStyle}
      {!MaskActive && (
        <ArtworkArrayControls
          Document={doc}
          Selection={selected}
          OnError={setError}
          OnFinalize={(Next, Indices) => {
            commit(Next, { selected: Indices });
            setTool("move");
          }}
        />
      )}
    </>
  );
  const SurfacePage = (
    <>
      {l ? (
        <fieldset disabled={!!l.locked} className="sfw-fieldset">
          {Unlock}
          <section className="sfw-card">
            <header>
              <b>Material surface</b>
              <small>{l.name}</small>
            </header>
            <label className="sfw-row">
              Finish
              <select
                aria-label="Motif material"
                value={l.finish}
                onChange={(Event) => {
                  const F = patternFinishes[Event.target.value];
                  layer({ finish: Event.target.value, roughness: F.roughness, metalness: F.metalness, relief: F.height });
                }}
              >
                {Object.entries(patternFinishes).map(([Key, F]) => (
                  <option key={Key} value={Key}>
                    {F.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sfw-grid3">
              {field("Roughness", "roughness", 0.05, 1, 0.01)}
              {field("Metalness", "metalness", 0, 1, 0.05)}
              {field("Relief (mm)", "relief", -1, 1, 0.01)}
            </div>
            <button className="sfw-wide" onClick={() => commit({ ...doc, layers: doc.layers.map((P) => (P.locked ? P : { ...P, finish: l.finish, roughness: l.roughness, metalness: l.metalness, relief: l.relief })) })}>
              Give every motif this finish
            </button>
          </section>
          <ArtworkMaskControls
            Mask={l.mask}
            Editing={MaskActive}
            OnEdit={() => {
              if (canvasRef.current?.hasPendingPath() && !canvasRef.current.prepareExport()) return;
              ConfigureMaskIdentity(l.id);
              ShowView("design");
            }}
            OnChange={(Mask) => {
              if (!l.locked) commit({ ...docRef.current, layers: docRef.current.layers.map((Entry) => (Entry.id === l.id ? { ...Entry, mask: Mask } : Entry)) });
            }}
            OnError={setError}
          />
        </fieldset>
      ) : (
        <p className="sfw-hint sfw-card">Select a motif to set its finish, its surface channels and its mask.</p>
      )}
      {!MaskActive && <PatternSurfaceChannelControls Document={doc} Selection={selected} OnFinalize={commit} OnError={setError} />}
    </>
  );
  const RepeatPage = (
    <>
      <section className="sfw-card">
        <header>
          <b>Repeat</b>
          <small>{doc.tileAxes === "xy" ? "Seamless tile" : doc.tileAxes === "none" ? "Finite rug" : "One-way border"}</small>
        </header>
        <label className="sfw-row">
          Layout
          <select aria-label="Repeat layout" disabled={doc.tileAxes !== "xy"} value={doc.repeat} onChange={(Event) => update({ repeat: Event.target.value })}>
            <option value="straight">Straight</option>
            <option value="half-drop">Half drop</option>
            <option value="mirror">Mirrored</option>
          </select>
        </label>
        <div className="sfw-pair">
          <label>
            Repeats
            <input aria-label="Pattern repeats" type="number" min=".25" max="16" step=".25" value={doc.repeats} onChange={(Event) => update({ repeats: +Event.target.value })} />
          </label>
          <label>
            Rotation
            <input aria-label="Pattern rotation" type="number" min="-180" max="180" value={doc.rotation} onChange={(Event) => update({ rotation: +Event.target.value })} />
          </label>
        </div>
        <label className="sfw-row">
          Mapping
          <select aria-label="Pattern mapping" value={doc.mapping} onChange={(Event) => update({ mapping: Event.target.value })}>
            <option value="uv">Surface UV — fabrics / decoration</option>
            <option value="object">Object projection</option>
            <option value="cylinder">Cylindrical — pottery</option>
          </select>
        </label>
        <p className="sfw-hint">The material repeats the tile over its UVs by Repeats. Rotation and mapping stay with the pattern document.</p>
      </section>
      <section className="sfw-card">
        <header>
          <b>Ground</b>
          <small>Under every motif</small>
        </header>
        <PatternColourControls Caption="Ground" ColourLabel="Pattern ground color" Source={doc.backgroundSource} Solid={doc.background} OnChange={(Source, Colour) => update({ backgroundSource: Source, background: Colour })} />
        <label className="sfw-switch">
          <input type="checkbox" role="switch" checked={!doc.backgroundOpacity} onChange={(Event) => update({ backgroundOpacity: Event.target.checked ? 0 : 1 })} />
          Clear ground (the material shows through)
        </label>
      </section>
      {doc.fade && (
        <section className="sfw-card">
          <header>
            <b>Geometric fading</b>
            <small>Separated marks grow into a lattice</small>
          </header>
          <label className="sfw-row">
            Direction
            <select aria-label="Fade direction" value={doc.fade.direction} onChange={(Event) => commit(rebuildCollectionFade(doc, { direction: Event.target.value }))}>
              <option value="down">Small → large, downward</option>
              <option value="up">Small → large, upward</option>
              <option value="right">Small → large, rightward</option>
              <option value="left">Small → large, leftward</option>
            </select>
          </label>
          {[
            ["columns", "Motif density", 4, 22, 1],
            ["strength", "Fade strength", 0.3, 3, 0.1],
            ["minimum", "Smallest motif", 0, 0.6, 0.01],
            ["gap", "Lattice gap", 0.01, 0.35, 0.01],
            ["start", "Fade start", 0, 0.9, 0.01],
            ["end", "Fade end", 0.1, 1, 0.01],
          ].map(([Key, Caption, Min, Max, Step]) => (
            <label key={Key} className="sfw-range">
              <span>
                {Caption} <output>{doc.fade[Key]}</output>
              </span>
              <input aria-label={Caption} type="range" min={Min} max={Max} step={Step} value={doc.fade[Key]} onChange={(Event) => commit(rebuildCollectionFade(doc, { [Key]: +Event.target.value }))} />
            </label>
          ))}
          <label className="sfw-switch">
            <input type="checkbox" role="switch" aria-label="Loop fade seamlessly" checked={doc.fade.loop} onChange={(Event) => commit(rebuildCollectionFade(doc, { loop: Event.target.checked }))} />
            Loop the fade seamlessly
          </label>
        </section>
      )}
      <RugCompositionControls doc={doc} commit={commit} onError={setError} />
      <PatternTextileTools doc={doc} commit={commit} onError={setError} />
    </>
  );
  const ExportPage = (
    <>
      <section className="sfw-card">
        <header>
          <b>Pictures</b>
          <small>Vector shapes stay sharp in SVG</small>
        </header>
        <button className="sfw-wide" onClick={() => Finish() && SaveFile(patternSVG(docRef.current), "pattern.svg", "image/svg+xml")}>
          <Download size={13} /> {doc.tileAxes === "none" ? "Export rug SVG" : doc.tileAxes === "xy" ? "Export seamless SVG" : "Export border SVG"}
        </button>
        <div className="sfw-pair">
          <select aria-label="Pattern PNG resolution" value={exportSize} onChange={(Event) => setExportSize(+Event.target.value)}>
            {[512, 1024, 2048, 4096].map((Edge) => (
              <option key={Edge} value={Edge}>
                {Edge}px
              </option>
            ))}
          </select>
          <button disabled={busy} onClick={exportPNG}>
            <Download size={13} /> Export PNG
          </button>
        </div>
        <button className="sfw-wide" onClick={() => SaveFile(leatherSourceSVG(), "leather-source.svg", "image/svg+xml")}>
          Export leather source SVG
        </button>
      </section>
      <section className="sfw-card">
        <header>
          <b>Document</b>
          <small>Editable JSON, kept in this browser too</small>
        </header>
        <button className="sfw-wide" onClick={saveDocument}>
          <Save size={13} /> Save document
        </button>
        <button className="sfw-wide" disabled={busy} onClick={() => jsonInput.current.click()}>
          <FolderOpen size={13} /> Open document
        </button>
      </section>
    </>
  );
  const PageBodies = [ShapePage, SurfacePage, RepeatPage, ExportPage];

  // ── The canvas column ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Design = MaskActive ? (
    <ArtworkMaskCanvas
      key={l.id}
      Mask={l.mask}
      Name={l.name}
      Disabled={l.locked}
      OnSave={saveDocument}
      OnClose={() => ConfigureMaskIdentity(null)}
      OnError={setError}
      OnHistory={(Direction) => (Direction === "undo" ? undo() : redo())}
      OnChange={(Mask) => {
        if (!l.locked) commit({ ...docRef.current, layers: docRef.current.layers.map((Entry) => (Entry.id === l.id ? { ...Entry, mask: Mask } : Entry)) });
      }}
    />
  ) : (
    <div className="sfw-canvas-row">
      <ShapeEditorCanvas
        ref={canvasRef}
        doc={doc}
        selected={selected}
        tool={tool}
        onToolChange={changeTool}
        grid={grid}
        aspect={aspect}
        showGrid={showGrid}
        smartGuides={smartGuides}
        snapping={snapping}
        style={drawingStyle}
        onDrawingStyle={(Patch) => setDrawingStyle((Previous) => ({ ...Previous, ...Patch }))}
        onCreateText={createText}
        onEditText={editText}
        onSampleAppearance={sampleAppearance}
        onSelection={setSelected}
        onPreview={previewDocument}
        onCommit={commit}
        onCancel={cancelDocument}
        onError={setError}
        onAction={action}
        onPathStateChange={Model.setPathState}
        onWorkingDraft={persistWorkingDraft}
        onPathDirty={(Points) => setDraftStatus(Points < 2 ? "Place another anchor" : "Saving path draft…")}
        pathPanelTarget={Model.pathPanelTarget}
        ViewControlsTarget={ZoomSlot}
        WorldGrid
      />
    </div>
  );
  // ── The Viewport header's action row: every drawing tool in families, then the grid, snapping, canvas options and zoom ──────────────────────────────────────────────
  // At narrow widths the less used tools fold into More (ToolFamilies marks them Spare).
  const ToolPick = (Key) => {
    changeTool(Key);
    if (View !== "design") Show("design");
  };
  // ── The quick menu (the remastered Texture Studio's): right-click the canvas, press Q or Tab, or the rail's Quick menu pill ───────────
  // A right-click on a shape selects it first, as the canvas's own menu did; its actions (duplicate, group, order, lock, delete) live here.
  const Menu = useQuickMenu(PatternRoot, {
    Keys: ["Tab"],
    Before: (Target) => {
      const Hit = Target?.closest?.("[data-layer]");
      if (!Hit || MaskActive) return;
      const At = Number(Hit.dataset.layer);
      if (!selected.includes(At)) setSelected(expandPatternSelection(doc, At));
    },
  });
  const Editable = selected.filter((At) => doc.layers[At] && !doc.layers[At].locked);
  const ToolEntry = (Key) => shapeTools.find(([Each]) => Each === Key);
  const SendToPaint = async () => {
    if ((await ApplyToMaterial()) && OpenStudio) {
      Menu.Hide();
      OpenStudio("paint");
    }
  };
  const QuickPanel = (
    <QuickMenu Control={Menu} Category="pattern" Glyph={<LayoutGrid size={14} />} Title={selected.length > 1 ? `${selected.length} shapes · quick menu` : l ? `${l.name} quick menu` : "Pattern quick menu"} Keys="Q / Tab / Esc">
      {!MaskActive && (
        <MenuTabs
          Label="Drawing tools"
          Columns={4}
          Tabs={MenuTools.map((Key) => {
            const [, Caption, , Glyph] = ToolEntry(Key);
            return [Key, Caption.replace(/ tool$/i, ""), Glyph];
          })}
          Active={View === "design" ? tool : ""}
          Pick={ToolPick}
        />
      )}
      <MenuLabel Note={doc.tileAxes === "xy" ? "edges wrap" : doc.tileAxes === "none" ? "finite rug" : "one-way border"}>Canvas view</MenuLabel>
      <MenuChips
        Label="Canvas view"
        Chips={[
          ["design", "Design", View === "design" && !MaskActive, () => Show("design"), MaskActive],
          ["repeat", "Repeat", View === "repeat" && !MaskActive, () => Show("repeat"), MaskActive],
          ["grid", "Grid", showGrid, () => setShowGrid((On) => !On)],
          ["snap", "Snap", smartGuides, () => setSmartGuides((On) => !On)],
        ]}
      />
      <MenuLabel Note={l ? l.name : "select a shape"}>Quick add modifier</MenuLabel>
      <MenuChips
        Label="Quick add modifier"
        Chips={[
          ["reflect-x", <><FlipHorizontal2 size={12} /> Reflect X</>, undefined, () => add(l.kind, reflectPatternLayer(l, "x")), !l || l.locked, "Add a copy reflected across X"],
          ["reflect-y", <><FlipVertical2 size={12} /> Reflect Y</>, undefined, () => add(l.kind, reflectPatternLayer(l, "y")), !l || l.locked, "Add a copy reflected across Y"],
          ["ring", <><Orbit size={12} /> Ring × {ring.count}</>, undefined, () => commit({ ...doc, layers: doc.layers.flatMap((P, I) => (I === selection ? radialPatternLayers(P, ring.count, ring.radius) : [P])) }), !l || l.locked, `Arrange ${ring.count} copies in a ring of radius ${ring.radius} (Shape page · Reflect & ring)`],
          ["duplicate", <><Copy size={12} /> Duplicate</>, undefined, () => action("duplicate"), !Editable.length, "Duplicate · Ctrl/⌘ D"],
        ]}
      />
      <MenuLabel Note={selected.length ? `${selected.length} selected` : "nothing selected"}>Selection</MenuLabel>
      <div className="qm-actions">
        {[
          ["group", "Group", Group, Editable.length < 2],
          ["front", "To front", BringToFront, !Editable.length],
          ["back", "To back", SendToBack, !Editable.length],
          ["lock", "Lock", Lock, !Editable.length],
          ["delete", "Delete", Trash2, !Editable.length],
        ].map(([Act, Caption, Glyph, Disabled]) => (
          <button key={Act} type="button" className="qm-action" disabled={Disabled || MaskActive} onClick={() => action(Act)}>
            <Glyph size={13} /> {Caption}
          </button>
        ))}
      </div>
      <button type="button" className="qm-accent" disabled={busy || !!Applying} onClick={OpenStudio ? SendToPaint : ApplyToMaterial} title={`Write this pattern into ${Owner}, then open Texture paint`}>
        <Paintbrush size={14} /> {Applying || (OpenStudio ? "Send pattern to Texture paint" : "Apply to material")}
      </button>
    </QuickMenu>
  );
  const ToolButton = ([Key, Caption, Keys, Glyph, Title], Spare) => (
    <button key={Key} className={"sfw-tool" + (tool === Key && View === "design" ? " on" : "") + (Spare ? " spare" : "")} disabled={MaskActive} aria-pressed={tool === Key && View === "design"} aria-label={`${Caption} (${Keys})`} title={(Title || Caption) + " · " + Keys} onClick={() => ToolPick(Key)}>
      <Glyph size={16} />
    </button>
  );
  const Tools = MaskActive ? (
    <span className="sfw-view-note">Painting a mask · its brushes sit on the mask canvas</span>
  ) : (
    <>
        {ToolFamilies.map(([Family, Keys], At) => (
          <React.Fragment key={Family}>
            {At > 0 && <span className="sfw-view-divider" />}
            <span className="sfw-view-family" role="group" aria-label={Family}>
              {Keys.map((Key) => ToolButton(shapeTools.find(([Each]) => Each === Key.replace("~", "")), Key.startsWith("~")))}
            </span>
          </React.Fragment>
        ))}
        <span className="sfw-view-divider" />
        <Popover Label="More tools" Caption="More tools" Glyph={<MoreHorizontal size={15} />} className="sfw-more-pill" Disabled={MaskActive}>
          <span className="sfw-menu-title">More drawing tools</span>
          <div className="sfw-menu-tools">
            {ToolFamilies.flatMap(([, Keys]) => Keys.filter((Key) => Key.startsWith("~"))).map((Key) => (
              <span key={Key} data-closes>
                {ToolButton(shapeTools.find(([Each]) => Each === Key.slice(1)))}
              </span>
            ))}
          </div>
          <button data-closes onClick={() => openSVGSource()}>
            <Code2 size={13} /> Paste SVG source
          </button>
          <button data-closes onClick={() => ShowShortcuts(true)}>
            <CircleHelp size={13} /> Keyboard shortcuts
          </button>
        </Popover>
        <button type="button" data-quick-menu-toggle className={"sfw-tool labelled sfw-menu-pill" + (Menu.At ? " on" : "")} aria-label="Pattern quick menu" aria-expanded={!!Menu.At} title="Quick menu · right-click the canvas or press Q" onClick={Menu.Toggle}>
          <SlidersHorizontal size={14} /> Quick menu <kbd>Q</kbd>
        </button>
    </>
  );
  const Trailing = (
    <>
        <button className={"sfw-tool" + (showGrid ? " on" : "")} aria-label="Show grid" aria-pressed={showGrid} title="Show grid" onClick={() => setShowGrid((On) => !On)}>
          <Grid3X3 size={15} />
        </button>
        <button className={"sfw-tool" + (smartGuides ? " on" : "")} aria-label="Snap to targets" aria-pressed={smartGuides} title="Snap to anchors, curves and alignment guides" onClick={() => setSmartGuides((On) => !On)}>
          <Magnet size={15} />
        </button>
        <Popover Label="Canvas options" Glyph={<SlidersHorizontal size={15} />} Align="end">
          <span className="sfw-menu-title">Grid & snapping</span>
          <label className="sfw-switch">
            <input type="checkbox" role="switch" aria-label="Show grid" checked={showGrid} onChange={() => setShowGrid((On) => !On)} />
            <Grid3X3 size={13} /> Show grid
          </label>
          <label className="sfw-row">
            Grid snap
            <select
              aria-label="Grid snapping"
              value={grid}
              onChange={(Event) => {
                setGrid(+Event.target.value);
                if (+Event.target.value) setShowGrid(true);
              }}
            >
              <option value="0">Off</option>
              {[8, 16, 32, 64].map((Step) => (
                <option key={Step} value={Step}>
                  {Step} units
                </option>
              ))}
            </select>
          </label>
          <label className="sfw-switch">
            <input type="checkbox" role="switch" aria-label="Smart alignment guides" checked={smartGuides} onChange={() => setSmartGuides((On) => !On)} />
            <Magnet size={13} /> Snap to targets
          </label>
          {[
            ["points", "Anchors & centres"],
            ["curves", "Curves & edges"],
            ["guides", "Object alignment"],
          ].map(([Key, Caption]) => (
            <label key={Key} className="sfw-switch indent">
              <input aria-label={`Snap to ${Caption.toLowerCase()}`} type="checkbox" role="switch" checked={snapping[Key]} onChange={(Event) => setSnapping({ ...snapping, [Key]: Event.target.checked })} />
              {Caption}
            </label>
          ))}
          <label className="sfw-row">
            Angle snap
            <select aria-label="Angle snapping" value={snapping.angle} onChange={(Event) => setSnapping({ ...snapping, angle: +Event.target.value })}>
              {[0, 15, 30, 45, 90].map((Step) => (
                <option key={Step} value={Step}>
                  {Step ? `${Step}°` : "Off"}
                </option>
              ))}
            </select>
          </label>
          <label className="sfw-switch">
            <input type="checkbox" role="switch" aria-label="Keep aspect ratio" checked={aspect} onChange={(Event) => setAspect(Event.target.checked)} />
            Constrain proportions
          </label>
        </Popover>
      <span className="sfw-view-divider" />
      <span className="sfw-zoom-slot" ref={PlaceZoomSlot} />
    </>
  );
  const Repeat = (
    <div className="sfw-repeat-view">
      <div
        className="sfw-repeat-tiles"
        aria-label="Repeated pattern preview"
        style={{
          backgroundImage: `url("${preview}")`,
          backgroundRepeat: doc.tileAxes === "none" ? "no-repeat" : doc.tileAxes === "x" ? "repeat-x" : doc.tileAxes === "y" ? "repeat-y" : "repeat",
          backgroundSize: doc.tileAxes === "none" ? "contain" : doc.tileAxes !== "xy" ? `${TileSize * 1.33}px ${TileSize * 1.33}px` : `${TileSize * (doc.repeat === "straight" ? 1 : 2)}px ${TileSize * (doc.repeat === "mirror" ? 2 : 1)}px`,
          backgroundPosition: "center",
        }}
      />
      <div className="sfw-dock" role="toolbar" aria-label="Repeat preview">
        <span className="sfw-dock-note">
          <span className="sfw-live" />
          {doc.tileAxes === "xy" ? "Edges wrap · drag motifs across the boundary in Design" : doc.tileAxes === "none" ? "Finite rug · edges do not wrap" : "One-way border · repeats across the fade only"}
        </span>
        <span className="sfw-dock-split" />
        <label className="sfw-dock-range">
          Tile
          <input aria-label="Repeat preview tile size" type="range" min="48" max="420" value={TileSize} onChange={(Event) => SizeTiles(+Event.target.value)} />
          <output>{TileSize}px</output>
        </label>
      </div>
    </div>
  );

  return (
    <div
      ref={PatternRoot}
      className="surface-workspace pattern-workspace alloy-scope studio-themed"
      data-surface-workspace="pattern"
      onKeyDown={(Event) => {
        if (svgSource) return;
        keyDown(Event);
      }}
    >
      <div className={"sfw-body sfw-docks" + (Shut.left ? " no-left" : "") + (Shut.right ? " no-right" : "")} inert={svgSource ? "" : undefined}>
        {!Shut.left && (
          <section className="sfw-rail ao-rail sfw-pane left" aria-label="LayerStack dock">
            <DockTabs
              Label="LayerStack dock"
              Tabs={[
                { Id: "layers", Label: "LayerStack" },
                { Id: "library", Label: "Library" },
              ]}
              Active={Rail}
              Pick={ShowRail}
              Close={() => ShutDocks((Previous) => ({ ...Previous, left: true }))}
            />
            {Rail === "layers" ? (
              Layers
            ) : (
              <>
                <OutlinerHeading Title="Library" Detail={`${patternStarterCatalog.length} patterns`} />
                {Library}
              </>
            )}
          </section>
        )}
        <section className="sfw-pane centre" aria-label="Viewport dock">
          <DockTabs Label="Viewport dock" Tabs={[{ Id: "viewport", Label: "Viewport" }]} Active="viewport" Restore={Shut.left || Shut.right ? () => ShutDocks({}) : undefined} />
          <ViewportHeader
            Picture={
              <span className="sfw-view-picture">
                <LayoutGrid size={15} />
              </span>
            }
            Name={<input className="sfw-view-name" aria-label="Pattern name" value={doc.name} onChange={(Event) => update({ name: Event.target.value })} />}
            Detail={
              <>
                .pattern · <span role="status">{Applied || draftStatus}</span>
              </>
            }
            ModesLabel="Pattern view"
            Modes={[
              ["design", "Design", View === "design" && !MaskActive, () => Show("design")],
              ["repeat", "Repeat", View === "repeat" && !MaskActive, () => Show("repeat")],
            ]}
            Actions={
              <>
                <button className="sfw-icon-button" onClick={undo} disabled={!canUndo && !pathState.canUndo} aria-label="Undo" title="Undo · Ctrl/⌘ Z">
                  <Undo2 size={15} />
                </button>
                <button className="sfw-icon-button" onClick={redo} disabled={!canRedo && !pathState.canRedo} aria-label="Redo" title="Redo · Ctrl/⌘ Shift Z">
                  <Redo2 size={15} />
                </button>
                <Popover Label="Pattern document" Glyph={<MoreHorizontal size={15} />} Align="end">
                  <button
                    data-closes
                    onClick={() => {
                      canvasRef.current?.cancelInteraction();
                      commit(patternStarter("Blank"), { selected: [] });
                      ConfigureMaskIdentity(null);
                      setTool("move");
                      ShowRail("library");
                      ShowView("design");
                    }}
                  >
                    <FilePlus2 size={13} /> New blank pattern
                  </button>
                  <button data-closes disabled={busy} onClick={() => jsonInput.current.click()}>
                    <FolderOpen size={13} /> Open document…
                  </button>
                  <button data-closes onClick={saveDocument}>
                    <Save size={13} /> Save document
                  </button>
                  <button data-closes onClick={() => ShowShortcuts(true)}>
                    <CircleHelp size={13} /> Keyboard shortcuts
                  </button>
                </Popover>
              </>
            }
            Primary={
              <button className="sfw-apply" disabled={busy || !!Applying} onClick={ApplyToMaterial} title={`Write this pattern into ${Owner}'s colour, roughness and metalness`}>
                <LayoutGrid size={14} /> {Applying || "Apply to material"}
              </button>
            }
            Tools={Tools}
            Trailing={Trailing}
          />
          {recoverable && (
            <div className="sfw-banner" role="status">
              <span>
                <b>Unsaved draft available</b> {recoverable.doc.name} · {recoverable.doc.layers.length} shapes
              </span>
              <button
                onClick={() => {
                  canvasRef.current?.cancelInteraction();
                  const Path = recoverable.doc.layers.findLastIndex((P) => P.nodes && !P.closed && !P.locked && P.visible);
                  commit(recoverable.doc, { selected: Path >= 0 ? [Path] : [] });
                  setRecoverable(null);
                  setTool("move");
                }}
              >
                Restore draft
              </button>
              <button
                onClick={() => {
                  setRecoverable(null);
                  try {
                    localStorage.removeItem(PATTERN_DRAFT_KEY);
                  } catch {}
                }}
              >
                Dismiss
              </button>
            </div>
          )}
          <main className="sfw-centre" data-mask-editing={MaskActive || undefined} {...Menu.Viewport}>
            {Construction && View === "design" && !MaskActive && <p className="sfw-construction">{Construction}</p>}
            {View === "repeat" && !MaskActive ? Repeat : Design}
            {error && (
              <p className="sfw-error" role="alert">
                {error}
                <button aria-label="Dismiss" onClick={() => setError("")}>
                  <X size={12} />
                </button>
              </p>
            )}
            {busy && (
              <p className="sfw-busy" role="status">
                Preparing embedded source…
              </p>
            )}
          </main>
        </section>
        {!Shut.right && (
          <section className="sfw-inspector sfw-pane right" data-mask-editing={MaskActive || undefined} aria-label="Inspector dock">
            <DockTabs Label="Inspector dock" Tabs={[{ Id: "inspector", Label: "Inspector" }]} Active="inspector" Close={() => ShutDocks((Previous) => ({ ...Previous, right: true }))} />
            <PageStrip Owner="Pattern" Pages={Pages} Index={Page} Pick={Turn} />
            <div className="sfw-pages">
              {PageBodies.map((Body, At) => (
                <div key={Pages[At].Id} {...PageLook(At, Page, Motion)} data-page={Pages[At].Id}>
                  {Body}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <input hidden type="file" ref={input} aria-label="Import pattern image" accept="image/png,image/jpeg,image/webp" onChange={(Event) => (importFile(Event.target.files[0], "image"), (Event.target.value = ""))} />
      <input hidden type="file" ref={svgInput} accept=".svg" onChange={(Event) => (importFile(Event.target.files[0], "svg"), (Event.target.value = ""))} />
      <input hidden type="file" ref={jsonInput} aria-label="Open pattern JSON" accept=".json" onChange={(Event) => (importFile(Event.target.files[0], "json"), (Event.target.value = ""))} />
      {ShortcutsOpen && (
        <div className="sfw-sheet" role="dialog" aria-label="Pattern shortcuts">
          <header>
            <b>Keyboard shortcuts</b>
            <button className="sfw-icon-button" aria-label="Close shortcuts" onClick={() => ShowShortcuts(false)}>
              <X size={14} />
            </button>
          </header>
          {Shortcuts.map(([Caption, Keys]) => (
            <span key={Caption}>
              {Caption}
              <kbd>{Keys}</kbd>
            </span>
          ))}
        </div>
      )}
      {svgSource && <SVGSourceEditor source={svgSource.source} editing={svgSource.index !== null} onApply={embedSVG} onClose={() => setSVGSource(null)} />}
      {QuickPanel}
    </div>
  );
}
