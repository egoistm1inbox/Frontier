import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useLayoutEffect,
} from "react";
import ShaderballPanel from "./ShaderballPanel.jsx";
import {
  MaterialChannels,
  MaterialTypes,
  SourceNames,
  ResolveMaterial,
  ResolveSlots,
  ChangeChannel,
  ChooseMaterialType,
  AddChannel,
  RemoveChannel,
  ShownChannel,
  ShaderLanguages,
  ShaderTemplate,
  MaterialSections,
  SectionSlots,
  MaximumMaterialSlots,
  Clamp,
  GradientCss,
  GradientValue,
} from "./MaterialSpecification.js";
import { ColourSlotDropProps } from "./ColourCodex.js";
import { AssetDropProps } from "./AssetDrag.js";
import { BakeShaderChannel, ShaderChannelPicture } from "./ShaderChannel.js";
import { EngineAssets } from "./AssetDepot.js";
import { ShapeOf } from "./PrimitiveInspector.jsx";

// Follow-up 68: Content Browser drops. A dropped image is shrunk to the embedded preview size; a dropped material lends
// one channel (its fill, gradient or texture is copied so the preview can draw it).
async function ShrinkPicture(Source, Name) {
  const Image = new window.Image();
  Image.src = Source;
  await Image.decode();
  const Canvas = document.createElement("canvas"),
    Ratio = Math.min(1, 160 / Math.max(Image.width, Image.height));
  Canvas.width = Math.max(1, Math.round(Image.width * Ratio));
  Canvas.height = Math.max(1, Math.round(Image.height * Ratio));
  Canvas.getContext("2d").drawImage(Image, 0, 0, Canvas.width, Canvas.height);
  return { Name, Data: Canvas.toDataURL("image/png"), Width: Image.width, Height: Image.height };
}
export function LinkFromAsset(Asset, Id) {
  const Lent = ResolveMaterial({ Material: Asset.Material }).Channels[Id];
  const Drawn = ShownChannel(Lent);
  const Copyable = ["Fill", "Gradient", "Texture"].includes(Drawn.Source);
  return {
    AssetId: Asset.Id,
    Name: Asset.Name || Asset.Material?.Name || "Material",
    Snapshot: {
      Source: Copyable ? Drawn.Source : "Fill",
      Fill: Drawn.Fill,
      Stops: Drawn.Stops,
      Axis: Drawn.Axis,
      Texture: Drawn.Texture,
      Component: Drawn.Component,
      Repeat: Drawn.Repeat,
    },
  };
}
const ChannelSwatch = (Owned, Field) => {
  const Drawn = ShownChannel(Owned);
  return Drawn.Source === "Gradient"
    ? GradientCss(Drawn, Field)
    : Field.Kind === "Colour"
      ? Drawn.Fill
      : undefined;
};
import "./MaterialPanel.css";

function NumericInput(Props) {
  const [Draft, EditDraft] = useState(String(Props.value));
  useLayoutEffect(() => EditDraft(String(Props.value)), [Props.value]);
  return (
    <input
      {...Props}
      value={Draft}
      onChange={(Event) => {
        EditDraft(Event.target.value);
        if (Event.target.value !== "") Props.onChange(Event);
      }}
      onBlur={() => EditDraft(String(Props.value))}
    />
  );
}

function ValueInput({ Field, Value, Change, Label, SlotTitle }) {
  const [Draft, EditDraft] = useState(String(Value));
  const LatestChange = useRef(Change);
  LatestChange.current = Change;
  useEffect(() => EditDraft(String(Value)), [Value]);
  if (Field.Kind === "Colour")
    return (
      <div
        className="colour-input"
        {...ColourSlotDropProps({
          Label: SlotTitle || Label,
          AssignHex: (Hex) => LatestChange.current(Hex),
        })}
      >
        <input
          aria-label={Label}
          type="color"
          value={Value}
          onChange={(Event) => LatestChange.current(Event.target.value)}
        />
        <input
          aria-label={Label + " hex"}
          value={Draft}
          maxLength={7}
          onChange={(Event) => EditDraft(Event.target.value)}
          onBlur={() => {
            if (/^#[0-9a-f]{6}$/i.test(Draft)) LatestChange.current(Draft);
            else EditDraft(String(Value));
          }}
          onKeyDown={(Event) => {
            if (Event.key === "Enter") Event.currentTarget.blur();
          }}
          onFocus={(Event) => Event.target.select()}
        />
        <span>sRGB</span>
      </div>
    );
  return (
    <div className="material-number">
      <NumericInput
        type="number"
        aria-label={Label}
        min={Field.Minimum}
        max={Field.Maximum}
        step={Field.Id === "displacement" ? 0.001 : 0.01}
        value={Value}
        onChange={(Event) =>
          Change(Clamp(Event.target.value, Field.Minimum, Field.Maximum))
        }
      />
      <span>{Field.Unit || "value"}</span>
      <input
        aria-label={Label + " slider"}
        type="range"
        min={Field.Minimum}
        max={Field.Maximum}
        step={Field.Id === "displacement" ? 0.001 : 0.01}
        value={Value}
        onChange={(Event) => Change(+Event.target.value)}
      />
    </div>
  );
}
function GradientEditor({ Field, Channel, Change }) {
  const [Selected, Select] = useState(Channel.Stops[0].Id),
    Track = useRef(null);
  const Current =
    Channel.Stops.find((Stop) => Stop.Id === Selected) || Channel.Stops[0];
  const Assign = (Id, Patch) =>
    Change({
      Stops: Channel.Stops.map((Stop) =>
        Stop.Id === Id ? { ...Stop, ...Patch } : Stop,
      ),
    });
  const Add = () => {
    const Sorted = [...Channel.Stops].sort((A, B) => A.Position - B.Position);
    let Left = Sorted[0],
      Right = Sorted.at(-1);
    for (let Index = 1; Index < Sorted.length; Index++)
      if (
        Sorted[Index].Position - Sorted[Index - 1].Position >=
          Right.Position - Left.Position ||
        (Sorted.length > 2 && Index === 1)
      ) {
        Left = Sorted[Index - 1];
        Right = Sorted[Index];
      }
    const Position = (Left.Position + Right.Position) / 2,
      Id = crypto.randomUUID();
    Change({
      Stops: [
        ...Channel.Stops,
        {
          Id,
          Position,
          Value: GradientValue(Channel, Position, Field.Kind === "Colour"),
        },
      ],
    });
    Select(Id);
  };
  return (
    <div className="gradient-editor">
      <div className="material-section-title">
        <h3>Gradient stops</h3>
        <select
          aria-label="Gradient axis"
          value={Channel.Axis}
          onChange={(Event) => Change({ Axis: Event.target.value })}
        >
          <option value="U">U · horizontal</option>
          <option value="V">V · vertical</option>
        </select>
      </div>
      <div
        className="gradient-track"
        ref={Track}
        style={{ background: GradientCss(Channel, Field) }}
      >
        {Channel.Stops.map((Stop, Index) => (
          <button
            key={Stop.Id}
            className={Current.Id === Stop.Id ? "selected" : ""}
            style={{ left: Stop.Position * 100 + "%" }}
            aria-label={"Gradient stop " + (Index + 1)}
            aria-pressed={Current.Id === Stop.Id}
            onClick={() => Select(Stop.Id)}
            onPointerDown={(Event) => {
              Select(Stop.Id);
              Event.currentTarget.setPointerCapture(Event.pointerId);
            }}
            onPointerMove={(Event) => {
              if (!Event.currentTarget.hasPointerCapture(Event.pointerId))
                return;
              const Rect = Track.current.getBoundingClientRect();
              Assign(Stop.Id, {
                Position: +Clamp(
                  (Event.clientX - Rect.left) / Rect.width,
                ).toFixed(3),
              });
            }}
            onPointerUp={(Event) =>
              Event.currentTarget.releasePointerCapture(Event.pointerId)
            }
            onKeyDown={(Event) => {
              if (["ArrowLeft", "ArrowRight"].includes(Event.key)) {
                Event.preventDefault();
                Assign(Stop.Id, {
                  Position: Clamp(
                    Stop.Position + (Event.key === "ArrowRight" ? 0.01 : -0.01),
                  ),
                });
              }
            }}
          >
            ◇
          </button>
        ))}
      </div>
      <div className="gradient-scale">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      <div className="stop-editor">
        <label>
          Stop position{" "}
          <NumericInput
            type="number"
            aria-label="Stop position"
            min="0"
            max="100"
            step="1"
            value={+(Current.Position * 100).toFixed(1)}
            onChange={(Event) =>
              Assign(Current.Id, { Position: Clamp(Event.target.value / 100) })
            }
          />
          <span>%</span>
        </label>
        <ValueInput
          Field={Field}
          Value={Current.Value}
          Label="Stop value"
          Change={(Value) => Assign(Current.Id, { Value })}
        />
      </div>
      <div className="gradient-actions">
        <button disabled={Channel.Stops.length >= 8} onClick={Add}>
          + Add stop
        </button>
        <button
          disabled={Channel.Stops.length <= 2}
          onClick={() => {
            Change({
              Stops: Channel.Stops.filter((Stop) => Stop.Id !== Current.Id),
            });
            Select(Channel.Stops.find((Stop) => Stop.Id !== Current.Id).Id);
          }}
        >
          Remove stop
        </button>
        <span>{Channel.Stops.length} / 8 stops</span>
      </div>
      <p>
        Linear interpolation in UV space. Drag a stop or use arrow keys. Scalar
        channels interpolate values, not colour.
      </p>
    </div>
  );
}
// Follow-up 68: the Material source borrows this channel from a material asset, dropped from the Content Browser or picked here.
function MaterialLinkEditor({ Field, Channel, Change }) {
  const Presets = useMemo(() => {
    try {
      return EngineAssets().filter((Asset) => Asset.Kind === "Materials");
    } catch {
      return [];
    }
  }, []);
  const Link = Channel.Link;
  const Shown = ShownChannel(Channel);
  return (
    <div className="link-editor">
      <div
        className={"link-drop " + (Link ? "linked" : "")}
        {...AssetDropProps(["Materials"], (Asset) =>
          Change({ Source: "Link", Link: LinkFromAsset(Asset, Field.Id) }),
        )}
      >
        {Link ? (
          <>
            <span
              className="link-swatch"
              style={{ background: ChannelSwatch(Channel, Field) || "#3a3a3a" }}
            >
              {Field.Kind !== "Colour" && Shown.Source === "Fill"
                ? (+Shown.Fill).toFixed(2)
                : ""}
            </span>
            <span className="link-name">
              {Link.Name}
              <small>
                {Field.Label} · {Shown.Source === "Fill" ? "constant" : Shown.Source.toLowerCase()} copied from the asset
              </small>
            </span>
            <button aria-label="Unlink material" onClick={() => Change({ Source: "Fill", Link: null })}>
              ×
            </button>
          </>
        ) : (
          <span className="link-empty">
            ⬚<small>Drop a material from the Content Browser</small>
          </span>
        )}
      </div>
      <label>
        Or choose a built-in material
        <select
          aria-label="Linked material"
          value={Presets.some((Asset) => Asset.Id === Link?.AssetId) ? Link.AssetId : ""}
          onChange={(Event) => {
            const Asset = Presets.find((Each) => Each.Id === Event.target.value);
            if (Asset) Change({ Source: "Link", Link: LinkFromAsset(Asset, Field.Id) });
          }}
        >
          <option value="">{Link && !Presets.some((Asset) => Asset.Id === Link.AssetId) ? Link.Name : "Choose…"}</option>
          {Presets.map((Asset) => (
            <option key={Asset.Id} value={Asset.Id}>
              {Asset.Name}
            </option>
          ))}
        </select>
      </label>
      <p>
        The link copies the asset's {Field.Label.toLowerCase()} at the moment it
        is dropped. Drop again to refresh it.
      </p>
    </div>
  );
}

function SourceEditor({ Field, Channel, Change }) {
  const Compiled = useMemo(() => {
    if (Channel.Source !== "Code" || Channel.Code.Language !== "GLSL") return null;
    const Result = BakeShaderChannel(Channel.Code.Text, Field);
    const Line = +(/^Line (\d+):/.exec(Result.Error || "")?.[1] || 0);
    return { Error: Result.Error, Line, Picture: ShaderChannelPicture(Result) };
  }, [Channel.Source, Channel.Code.Language, Channel.Code.Text, Field]);
  const [Message, Report] = useState(""),
    Request = useRef(0),
    Mounted = useRef(true);
  useEffect(
    () => () => {
      Mounted.current = false;
    },
    [],
  );
  const Import = async (Event) => {
    const File = Event.target.files?.[0];
    Event.target.value = "";
    if (!File) return;
    const Ticket = ++Request.current;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(File.type) ||
      File.size > 8 * 1024 * 1024
    ) {
      Report("Choose a PNG, JPEG or WebP under 8 MB.");
      return;
    }
    const Url = URL.createObjectURL(File);
    try {
      const Image = new window.Image();
      Image.src = Url;
      await Image.decode();
      const Canvas = document.createElement("canvas"),
        Ratio = Math.min(1, 160 / Math.max(Image.width, Image.height));
      Canvas.width = Math.max(1, Math.round(Image.width * Ratio));
      Canvas.height = Math.max(1, Math.round(Image.height * Ratio));
      Canvas.getContext("2d").drawImage(
        Image,
        0,
        0,
        Canvas.width,
        Canvas.height,
      );
      if (Mounted.current && Ticket === Request.current) {
        Change({
          Texture: {
            Name: File.name,
            Data: Canvas.toDataURL("image/png"),
            Width: Image.width,
            Height: Image.height,
          },
        });
        Report("Embedded preview saved. Original texture stays on disk.");
      }
    } catch {
      if (Mounted.current)
        Report(
          "Image could not be decoded. The previous texture is unchanged.",
        );
    } finally {
      URL.revokeObjectURL(Url);
    }
  };
  return (
    <section className="channel-editor">
      <div className="material-section-title">
        <div>
          <span className="material-eyebrow">
            {Field.Group} / CHANNEL{" "}
            {String(MaterialChannels.indexOf(Field) + 1).padStart(2, "0")}
          </span>
          <h2>{Field.Label}</h2>
        </div>
        <span className={"source-indicator " + Channel.Source.toLowerCase()}>
          {Channel.Source === "Code"
            ? Channel.Code.Language === "GLSL"
              ? Compiled?.Error
                ? "Shader error"
                : "Live shader"
              : "Native only"
            : Channel.Source === "Link"
              ? "Linked"
              : Channel.Source === "Texture" && !Channel.Texture
                ? "No image"
                : "Authored"}
        </span>
      </div>
      <div
        className="source-tabs"
        role="group"
        aria-label={Field.Label + " source"}
      >
        {Object.entries(SourceNames).map(([Key, Name]) => (
          <button
            key={Key}
            aria-pressed={Channel.Source === Key}
            onClick={() => Change({ Source: Key })}
          >
            {Name}
          </button>
        ))}
      </div>
      <p className="source-explanation">
        One active source per channel; the others keep their drafts. Drop a
        material or image from the Content Browser onto the channel.
      </p>
      {Channel.Source === "Fill" && (
        <div className="fill-editor">
          <h3>{Field.Kind === "Colour" ? "Fill colour" : "Constant value"}</h3>
          {Field.Kind === "Colour" && (
            <div
              className="large-colour"
              style={{ background: Channel.Fill }}
              {...ColourSlotDropProps({
                Label: Field.Label + " fill",
                AssignHex: (Hex) => Change({ Fill: Hex }),
              })}
            />
          )}
          <ValueInput
            Field={Field}
            Value={Channel.Fill}
            Label={Field.Label + " fill"}
            Change={(Fill) => Change({ Fill })}
          />
        </div>
      )}
      {Channel.Source === "Gradient" && (
        <GradientEditor Field={Field} Channel={Channel} Change={Change} />
      )}
      {Channel.Source === "Texture" && (
        <div className="texture-editor">
          <div
            className="texture-drop"
            {...AssetDropProps(["Images"], async (Asset) => {
              const Ticket = ++Request.current;
              try {
                const Texture = await ShrinkPicture(Asset.Data, Asset.Name);
                if (Mounted.current && Ticket === Request.current) {
                  Change({ Texture });
                  Report(Asset.Name + " placed from the Content Browser.");
                }
              } catch {
                if (Mounted.current) Report("That image could not be decoded.");
              }
            })}
          >
            {Channel.Texture ? (
              <img src={Channel.Texture.Data} alt={Channel.Texture.Name} />
            ) : (
              <span className="texture-empty">
                ▧<small>No texture assigned · drop an image from the Content Browser</small>
              </span>
            )}
            <label className="texture-upload">
              {Channel.Texture ? "Replace texture" : "+ Choose texture"}
              <input
                aria-label="Upload channel texture"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={Import}
              />
            </label>
          </div>
          {Channel.Texture && (
            <div className="texture-file">
              <span>
                {Channel.Texture.Name}
                <small>
                  {Channel.Texture.Width} × {Channel.Texture.Height} · embedded
                  preview ≤160 px
                </small>
              </span>
              <button
                aria-label="Remove texture"
                onClick={() => {
                  Request.current++;
                  Change({ Texture: null });
                }}
              >
                ×
              </button>
            </div>
          )}
          <div className="texture-options">
            <label>
              Sample
              <select
                aria-label="Texture component"
                value={Channel.Component}
                onChange={(Event) => Change({ Component: Event.target.value })}
              >
                {(Field.Kind === "Colour"
                  ? ["RGB", "R", "G", "B", "A"]
                  : ["R", "G", "B", "A"]
                ).map((Name) => (
                  <option key={Name}>{Name}</option>
                ))}
              </select>
            </label>
            <label>
              UV repeat
              <NumericInput
                type="number"
                aria-label="Texture repeat"
                min=".1"
                max="16"
                step=".1"
                value={Channel.Repeat}
                onChange={(Event) =>
                  Change({ Repeat: Clamp(Event.target.value, 0.1, 16) })
                }
              />
            </label>
          </div>
          <p>
            PNG / JPEG / WebP · up to 8 MB. Local preview only; no upload or
            native texture descriptor.
          </p>
        </div>
      )}
      {Channel.Source === "Code" && (
        <div className="code-editor shader-source">
          <div className="shader-toolbar">
            <label>
              Language
              <select
                aria-label="Shader language"
                value={Channel.Code.Language}
                onChange={(Event) =>
                  Change({
                    Code: { ...Channel.Code, Language: Event.target.value },
                  })
                }
              >
                {ShaderLanguages.map((Name) => (
                  <option key={Name}>{Name}</option>
                ))}
              </select>
            </label>
            <button
              className="shader-reset"
              onClick={() =>
                Change({ Code: { ...Channel.Code, Text: ShaderTemplate(Field) } })
              }
            >
              Start from template
            </button>
          </div>
          <p className="shader-signature">
            {Channel.Code.Language === "GLSL" ? (
              <>
                Write <code>{Field.Kind === "Colour" ? "vec3" : "float"} channel(vec2 uv)</code>
                {Field.Kind === "Colour"
                  ? " returning a colour 0–1."
                  : ` returning ${Field.Minimum} to ${Field.Maximum}${Field.Unit ? " " + Field.Unit : ""}.`}{" "}
                It compiles as you type and the shader ball draws it.
              </>
            ) : (
              "Kept for the native renderer; the shader ball shows the fallback value below."
            )}
          </p>
          {Channel.Code.Language !== "GLSL" && (
            <label>
              Entry point
              <input
                aria-label="Shader entry point"
                placeholder="Project.Materials.UpdateColour"
                value={Channel.Code.Symbol}
                onChange={(Event) =>
                  Change({
                    Code: {
                      ...Channel.Code,
                      Symbol: Event.target.value.slice(0, 256),
                    },
                  })
                }
              />
            </label>
          )}
          <div className="shader-text">
            <ol className="shader-lines" aria-hidden="true">
              {Channel.Code.Text.split("\n").map((_, Index) => (
                <li
                  key={Index}
                  className={Compiled?.Line === Index + 1 ? "wrong" : ""}
                >
                  {Index + 1}
                </li>
              ))}
            </ol>
            <textarea
              aria-label="Channel shader"
              spellCheck="false"
              wrap="off"
              maxLength={12000}
              value={Channel.Code.Text}
              onKeyDown={(Event) => {
                if (Event.key !== "Tab") return;
                Event.preventDefault();
                const Area = Event.currentTarget,
                  From = Area.selectionStart,
                  To = Area.selectionEnd,
                  Text = Area.value.slice(0, From) + "  " + Area.value.slice(To);
                Change({ Code: { ...Channel.Code, Text } });
                requestAnimationFrame(() => Area.setSelectionRange(From + 2, From + 2));
              }}
              onChange={(Event) =>
                Change({ Code: { ...Channel.Code, Text: Event.target.value } })
              }
            />
          </div>
          {Channel.Code.Language === "GLSL" && (
            <div
              className={"shader-result " + (Compiled?.Error ? "wrong" : "fine")}
              role="status"
              data-shader-result={Compiled?.Error ? "error" : "compiled"}
            >
              {Compiled?.Picture && <img src={Compiled.Picture} alt="Shader output" />}
              <span>
                <b>{Compiled?.Error ? "Doesn't compile" : "Compiled · drawing live"}</b>
                <small>{Compiled?.Error || "128 × 128 across the surface UVs"}</small>
              </span>
            </div>
          )}
          <h3>{Channel.Code.Language === "GLSL" ? "Fallback while it doesn't compile" : "Preview fallback"}</h3>
          <ValueInput
            Field={Field}
            Value={Channel.Fill}
            Label="Shader fallback"
            Change={(Fill) => Change({ Fill })}
          />
        </div>
      )}
      {Channel.Source === "Link" && (
        <MaterialLinkEditor Field={Field} Channel={Channel} Change={Change} />
      )}
      {Message && (
        <p role="status" className="material-message">
          {Message}
        </p>
      )}
      {["ior", "reflectance"].includes(Field.Id) && (
        <p className="channel-note">
          Reflectance and refraction share one IOR carrier in the native
          material. Both rows stay synchronized.
        </p>
      )}
      {[
        "normal",
        "coatNormal",
        "anisotropy",
        "direction",
        "subsurface",
        "thickness",
        "displacement",
      ].includes(Field.Id) && (
        <p className="channel-note">
          Authoring supported. This channel is not evaluated by the browser
          lighting preview.
        </p>
      )}
    </section>
  );
}
export default function MaterialPanel({
  Subject,
  Values,
  Change,
  Expand,
  Compact = false,
  Slots: ShowSlots = true,
}) {
  // Follow-up 68: material slots. Slot 0 is Values.Material; slots 1+ are Values.MaterialSlots. Each section of the shape (box face,
  // cylinder cap, …) is drawn by one slot (Values.MaterialSections).
  const Slots = useMemo(() => (ShowSlots ? ResolveSlots(Values) : [ResolveMaterial(Values)]), [Values, ShowSlots]),
    [SlotShown, ShowSlot] = useState(0),
    Slot = Math.min(SlotShown, Slots.length - 1),
    Material = Slots[Slot],
    Shape = ShapeOf(Subject),
    Sections = MaterialSections(Shape),
    Covered = SectionSlots(Values, Shape),
    Latest = useRef(Material),
    LatestValues = useRef(Values),
    LatestChange = useRef(Change);
  Latest.current = Material;
  LatestValues.current = Values;
  LatestChange.current = Change;
  const [Selected, Select] = useState(() => Material.Used[0] || "colour"),
    [Adding, ShowAdding] = useState(false),
    [Query, Search] = useState("");
  const Current = Material.Used.includes(Selected) ? Selected : Material.Used[0];
  const Field = MaterialChannels.find((Entry) => Entry.Id === Current),
    Channel = Current ? Material.Channels[Current] : null;
  const Others = () => (Array.isArray(LatestValues.current.MaterialSlots) ? LatestValues.current.MaterialSlots : []);
  const Apply = (Next) => {
    if (Slot === 0) return LatestChange.current("Material", Next);
    const List = [...Others()];
    List[Slot - 1] = Next;
    LatestChange.current("MaterialSlots", List);
  };
  const Assign = (Id, Patch) => Apply(ChangeChannel(Latest.current, Id, Patch));
  const AddSlot = (From) => {
    if (Slots.length >= MaximumMaterialSlots) return;
    const Fresh = From
      ? { ...ResolveMaterial({ Material: From.Material }), Name: From.Name || From.Material?.Name || "Material" }
      : { ...ResolveMaterial({}), Name: "Material " + Slots.length };
    LatestChange.current("MaterialSlots", [...Others(), Fresh]);
    ShowSlot(Slots.length);
  };
  const RemoveSlot = (Index) => {
    LatestChange.current("MaterialSlots", Others().filter((_, At) => At !== Index - 1));
    LatestChange.current(
      "MaterialSections",
      Covered.map((Owner) => (Owner === Index ? 0 : Owner > Index ? Owner - 1 : Owner)),
    );
    if (Slot >= Index) ShowSlot(Slot - 1);
  };
  const ReplaceSlot = (Index, Asset) => {
    const Next = { ...ResolveMaterial({ Material: Asset.Material }), Name: Asset.Name || Asset.Material?.Name || "Material" };
    if (Index === 0) LatestChange.current("Material", Next);
    else {
      const List = [...Others()];
      List[Index - 1] = Next;
      LatestChange.current("MaterialSlots", List);
    }
    ShowSlot(Index);
  };
  const Cover = (Section) =>
    LatestChange.current(
      "MaterialSections",
      Covered.map((Owner, At) => (At === Section ? (Owner === Slot && Slot !== 0 ? 0 : Slot) : Owner)),
    );
  const Unused = MaterialChannels.filter(
    (Entry) =>
      !Material.Used.includes(Entry.Id) &&
      (Entry.Label + Entry.Group).toLowerCase().includes(Query.toLowerCase()),
  );
  const Authored = Material.Used.filter(
    (Id) => Material.Channels[Id].Source !== "Fill",
  ).length;
  return (
    <div
      className={
        "material-panel " + (Compact ? "material-compact" : "material-expanded")
      }
      data-material-owner={Subject.Id}
    >
      <header className="material-heading">
        <div>
          <span className="material-eyebrow">MATERIAL / SLOT {Slot}</span>
          <h2>{Compact ? "Material channels" : "ShaderEditor"}</h2>
          <p>
            Bound to <b>{Subject.Name}</b> · #{Subject.Id}
          </p>
        </div>
        {Expand && (
          <button
            className="material-expand"
            aria-label="Expand ShaderEditor"
            title="Open dockable ShaderEditor"
            onClick={Expand}
          >
            ↗
          </button>
        )}
      </header>
      {ShowSlots && (
        <section className="material-slots" aria-label="Material slots">
          <div className="material-section-title">
            <h3>Material slots</h3>
            <small>
              {Slots.length} / {MaximumMaterialSlots}
            </small>
          </div>
          <div className="slot-list" role="group" aria-label="Choose a material slot">
            {Slots.map((Each, Index) => {
              const Count = Covered.filter((Owner) => Owner === Index).length;
              return (
                <div
                  key={Index}
                  className={"slot-chip " + (Index === Slot ? "active" : "")}
                  data-material-slot={Index}
                  {...AssetDropProps(["Materials"], (Asset) => ReplaceSlot(Index, Asset))}
                >
                  <button
                    className="slot-pick"
                    aria-pressed={Index === Slot}
                    aria-label={"Material slot " + Index + " · " + Each.Name}
                    onClick={() => ShowSlot(Index)}
                  >
                    <span
                      className="slot-swatch"
                      style={{ background: ChannelSwatch(Each.Channels.colour, MaterialChannels[0]) }}
                    />
                    <span className="slot-name">
                      <small>Slot {Index}</small>
                      {Each.Name}
                    </span>
                    <span className="slot-count">
                      {Count === Sections.length ? "all" : Count + " / " + Sections.length}
                    </span>
                  </button>
                  {Index > 0 && (
                    <button
                      className="slot-remove"
                      aria-label={"Remove material slot " + Index}
                      title="Remove slot (its parts go back to slot 0)"
                      onClick={() => RemoveSlot(Index)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {Slots.length < MaximumMaterialSlots && (
              <button
                className="slot-add"
                aria-label="Add material slot"
                title="Add a slot, or drop a material from the Content Browser"
                onClick={() => AddSlot()}
                {...AssetDropProps(["Materials"], (Asset) => AddSlot(Asset))}
              >
                + Add slot
              </button>
            )}
          </div>
          {Sections.length > 1 && (
            <div className="slot-sections">
              <span>
                Slot {Slot} draws
                {Slot === 0 ? " every part not given to another slot" : ""}
              </span>
              <div role="group" aria-label={"Parts drawn by slot " + Slot}>
                {Sections.map((Name, Index) => (
                  <button
                    key={Name}
                    data-material-section={Index}
                    aria-pressed={Covered[Index] === Slot}
                    disabled={Slot === 0 && Covered[Index] === 0}
                    title={
                      Covered[Index] === Slot
                        ? Slot === 0
                          ? "Drawn by slot 0"
                          : "Click to give back to slot 0"
                        : "Drawn by slot " + Covered[Index] + " · click to take it"
                    }
                    onClick={() => Cover(Index)}
                  >
                    {Name}
                    {Covered[Index] !== Slot && <small>{Covered[Index]}</small>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      <div className="material-properties">
        <label>
          Material name
          <input
            aria-label="Material name"
            value={Material.Name}
            maxLength={80}
            onChange={(Event) =>
              Apply({ ...Material, Name: Event.target.value })
            }
          />
        </label>
        <label>
          Material type
          <select
            aria-label="Material type"
            value={Material.Type}
            onChange={(Event) =>
              Apply(ChooseMaterialType(Material, Event.target.value))
            }
          >
            {MaterialTypes.map((Name) => (
              <option key={Name}>{Name}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="material-type-note">
        {Material.Type === "SSR"
          ? "SSR is a reflection route, not a BSDF. Reflective preset here; screen-space tracing needs the native renderer."
          : "A type sets the channels it needs (Emissive adds Emission, Glass adds Transmission) and keeps your gradient, texture and shader drafts."}
      </p>
      <div className="material-stats">
        <div>
          <span>
            <i className="material-dot" />
            Channels in use
          </span>
          <strong>{Material.Used.length}</strong>
        </div>
        <div>
          <span>
            <i className="material-dot linked" />
            Non-fill sources
          </span>
          <strong>{Authored}</strong>
        </div>
      </div>
      <div className="material-workbench">
        <aside className="channel-library">
          <div className="material-section-title">
            <h3>Channels</h3>
            <small>
              {Material.Used.length} OF {MaterialChannels.length}
            </small>
          </div>
          <div className="channel-list" data-channel-list>
            {Material.Used.map((Id) => {
              const Entry = MaterialChannels.find((Each) => Each.Id === Id);
              const Owned = Material.Channels[Id];
              const Drawn = ShownChannel(Owned);
              return (
                <div
                  className={"channel-row " + (Current === Id ? "active" : "")}
                  key={Id}
                  {...AssetDropProps(["Materials", "Images"], async (Asset) => {
                    Select(Id);
                    if (Asset.Kind === "Images") {
                      try {
                        Assign(Id, { Source: "Texture", Texture: await ShrinkPicture(Asset.Data, Asset.Name) });
                      } catch {}
                    } else Assign(Id, { Source: "Link", Link: LinkFromAsset(Asset, Id) });
                  })}
                >
                  <button
                    className={Current === Id ? "active" : ""}
                    data-material-channel={Id}
                    aria-pressed={Current === Id}
                    onClick={() => Select(Id)}
                    {...(Entry.Kind === "Colour"
                      ? ColourSlotDropProps({
                          Key: Subject.Id + ":material:" + Slot + ":" + Id,
                          Label: Subject.Name + " · " + Entry.Label,
                          AssignHex: (Hex) => {
                            Select(Id);
                            Assign(Id, { Source: "Fill", Fill: Hex });
                          },
                        })
                      : {})}
                  >
                    <span
                      className="channel-swatch"
                      style={{ background: ChannelSwatch(Owned, Entry) }}
                    >
                      {Entry.Kind !== "Colour" && Drawn.Source !== "Gradient"
                        ? "◈"
                        : ""}
                    </span>
                    <span className="channel-name">
                      {Entry.Label}
                      <small>{Entry.Group}</small>
                    </span>
                    <span className="channel-value">
                      {Owned.Source === "Fill"
                        ? Entry.Kind === "Colour"
                          ? Owned.Fill
                          : (+Owned.Fill).toFixed(2)
                        : Owned.Source === "Link" && Owned.Link
                          ? Owned.Link.Name
                          : SourceNames[Owned.Source]}
                      <small>
                        {Owned.Source === "Code"
                          ? Owned.Code.Language
                          : Owned.Source === "Link"
                            ? Owned.Link
                              ? "linked"
                              : "unlinked"
                            : Owned.Source === "Texture"
                              ? Owned.Texture
                                ? "embedded"
                                : "unassigned"
                              : Owned.Source === "Gradient"
                                ? Owned.Stops.length + " stops"
                                : "constant"}
                      </small>
                    </span>
                  </button>
                  <button
                    className="channel-remove"
                    aria-label={"Remove channel " + Entry.Label}
                    title="Remove channel (it goes back to its default)"
                    onClick={() => Apply(RemoveChannel(Latest.current, Id))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {!Material.Used.length && (
              <p className="channel-none">
                No channels yet. Add the ones this material needs; the rest use
                their defaults.
              </p>
            )}
          </div>
          {Unused.length + Material.Used.length > 0 &&
            Material.Used.length < MaterialChannels.length && (
              <div className={"channel-adder " + (Adding ? "open" : "")}>
                <button
                  className="channel-add"
                  aria-expanded={Adding}
                  onClick={() => {
                    ShowAdding(!Adding);
                    Search("");
                  }}
                >
                  {Adding ? "Done" : "+ Add channel"}
                </button>
                {Adding && (
                  <div className="channel-picker" role="group" aria-label="Add a channel">
                    <input
                      className="channel-search"
                      aria-label="Search material channels"
                      placeholder="Search channels…"
                      autoFocus
                      value={Query}
                      onChange={(Event) => Search(Event.target.value)}
                    />
                    {[...new Set(Unused.map((Entry) => Entry.Group))].map((Group) => (
                      <div className="channel-picker-group" key={Group}>
                        <small>{Group}</small>
                        {Unused.filter((Entry) => Entry.Group === Group).map((Entry) => (
                          <button
                            key={Entry.Id}
                            data-add-channel={Entry.Id}
                            onClick={() => {
                              Apply(AddChannel(Latest.current, Entry.Id));
                              Select(Entry.Id);
                            }}
                          >
                            <span
                              className="channel-swatch"
                              style={{ background: Entry.Kind === "Colour" ? Entry.Default : undefined }}
                            >
                              {Entry.Kind !== "Colour" ? "◈" : ""}
                            </span>
                            {Entry.Label}
                            <i>+</i>
                          </button>
                        ))}
                      </div>
                    ))}
                    {!Unused.length && <p>No matching channels.</p>}
                  </div>
                )}
              </div>
            )}
        </aside>
        {Field ? (
          <SourceEditor
            key={Subject.Id + Slot + Current}
            Field={Field}
            Channel={Channel}
            Change={(Patch) => Assign(Current, Patch)}
          />
        ) : (
          <section className="channel-editor channel-editor-empty">
            <p>Add a channel to edit its source.</p>
          </section>
        )}
        <ShaderballPanel Material={Material} Compact={Compact} />
      </div>
    </div>
  );
}
