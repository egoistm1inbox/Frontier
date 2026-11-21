import React, { useEffect, useRef, useState } from "react";

const RememberedSectionByScope = new Map();

export default function SectionStageSwitcher({
  ScopeKey = "default",
  Sections = [],
  ActiveId: ControlledId,
  OnSelect,
  Compact = false,
  ShowStepMeta = true,
  AriaLabel = "Section stage switcher",
}) {
  const ValidSections = Sections.filter(Boolean);
  const TotalCount = ValidSections.length;

  const ResolveInitialId = () => {
    if (ControlledId !== undefined && ValidSections.some((S) => S.Id === ControlledId)) {
      return ControlledId;
    }
    const Remembered = RememberedSectionByScope.get(ScopeKey);
    if (Remembered && ValidSections.some((S) => S.Id === Remembered)) {
      return Remembered;
    }
    return ValidSections[0]?.Id ?? "";
  };

  const [InternalId, AssignInternalId] = useState(ResolveInitialId);
  const TrackRef = useRef(null);
  const ButtonRefs = useRef({});

  useEffect(() => {
    if (ControlledId !== undefined) return;
    const Remembered = RememberedSectionByScope.get(ScopeKey);
    if (Remembered && ValidSections.some((S) => S.Id === Remembered)) {
      AssignInternalId(Remembered);
    } else if (!ValidSections.some((S) => S.Id === InternalId)) {
      AssignInternalId(ValidSections[0]?.Id ?? "");
    }
  }, [ScopeKey, TotalCount]);

  if (TotalCount === 0) return null;

  const EffectiveId =
    ControlledId !== undefined && ValidSections.some((S) => S.Id === ControlledId)
      ? ControlledId
      : ValidSections.some((S) => S.Id === InternalId)
        ? InternalId
        : ValidSections[0].Id;

  const ActiveIndex = Math.max(
    0,
    ValidSections.findIndex((S) => S.Id === EffectiveId),
  );
  const ActiveSection = ValidSections[ActiveIndex] || ValidSections[0];

  const ActivateSection = (NextId, FocusTab = false) => {
    RememberedSectionByScope.set(ScopeKey, NextId);
    if (ControlledId === undefined) {
      AssignInternalId(NextId);
    }
    if (OnSelect) {
      OnSelect(NextId);
    }
    if (FocusTab) {
      requestAnimationFrame(() => {
        ButtonRefs.current[NextId]?.focus();
      });
    }
  };

  const StepRelative = (Delta, FocusTab = false) => {
    if (TotalCount <= 1) return;
    const NextIndex = (ActiveIndex + Delta + TotalCount) % TotalCount;
    const NextSection = ValidSections[NextIndex];
    if (NextSection) {
      ActivateSection(NextSection.Id, FocusTab);
    }
  };

  useEffect(() => {
    const Btn = ButtonRefs.current[EffectiveId];
    if (Btn && TrackRef.current) {
      try {
        Btn.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      } catch {}
    }
  }, [EffectiveId]);

  const HandleTrackKeyDown = (Ev) => {
    if (Ev.key === "ArrowRight") {
      Ev.preventDefault();
      StepRelative(1, true);
    } else if (Ev.key === "ArrowLeft") {
      Ev.preventDefault();
      StepRelative(-1, true);
    } else if (Ev.key === "Home") {
      Ev.preventDefault();
      ActivateSection(ValidSections[0].Id, true);
    } else if (Ev.key === "End") {
      Ev.preventDefault();
      ActivateSection(ValidSections[TotalCount - 1].Id, true);
    }
  };

  const HasStageBody = ActiveSection.Content !== undefined && ActiveSection.Content !== null;

  return (
    <div
      className={"section-stage-switcher" + (Compact ? " compact" : "")}
      data-switcher-scope={ScopeKey}
    >
      <div className="section-stage-bar">
        {TotalCount > 1 && (
          <button
            type="button"
            className="section-stage-chevron"
            aria-label="Previous section"
            title="Previous section"
            onClick={() => StepRelative(-1)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}

        <div
          ref={TrackRef}
          className="section-stage-track"
          role="tablist"
          aria-label={AriaLabel}
          onKeyDown={HandleTrackKeyDown}
        >
          <span className="section-stage-brace" aria-hidden="true">{"{"}</span>
          {ValidSections.map((Sec, Idx) => {
            const Selected = Sec.Id === EffectiveId;
            return (
              <React.Fragment key={Sec.Id}>
                {Idx > 0 && (
                  <span
                    className={
                      "section-stage-separator" +
                      (Selected || ValidSections[Idx - 1]?.Id === EffectiveId ? " muted" : "")
                    }
                    aria-hidden="true"
                  >
                    |
                  </span>
                )}
                <button
                  ref={(Node) => {
                    ButtonRefs.current[Sec.Id] = Node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={Selected}
                  tabIndex={Selected ? 0 : -1}
                  className={"section-stage-option" + (Selected ? " active" : "")}
                  style={Sec.Accent ? { "--stage-accent": Sec.Accent } : undefined}
                  onClick={() => ActivateSection(Sec.Id)}
                  title={Sec.Subtitle ? `${Sec.Label} — ${Sec.Subtitle}` : Sec.Label}
                >
                  {Sec.Accent && (
                    <i
                      className="section-stage-dot"
                      style={{ background: Sec.Accent }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="section-stage-label">{Sec.Label}</span>
                  {Sec.Count !== undefined && Sec.Count !== null && (
                    <small className="section-stage-count">{Sec.Count}</small>
                  )}
                </button>
              </React.Fragment>
            );
          })}
          <span className="section-stage-brace" aria-hidden="true">{"}"}</span>
        </div>

        {TotalCount > 1 && (
          <button
            type="button"
            className="section-stage-chevron"
            aria-label="Next section"
            title="Next section"
            onClick={() => StepRelative(1)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        )}
      </div>

      {!Compact && ShowStepMeta && TotalCount > 1 && (
        <div className="section-stage-meta">
          <span className="section-stage-subtitle">
            {ActiveSection.Subtitle || ActiveSection.Label}
          </span>
          <div className="section-stage-pips" aria-hidden="true">
            {ValidSections.map((Sec, Idx) => (
              <button
                key={Sec.Id}
                type="button"
                tabIndex={-1}
                className={"section-stage-pip" + (Idx === ActiveIndex ? " active" : "")}
                style={Idx === ActiveIndex && Sec.Accent ? { background: Sec.Accent } : undefined}
                onClick={() => ActivateSection(Sec.Id)}
              />
            ))}
            <small className="section-stage-count">
              {ActiveIndex + 1}/{TotalCount}
            </small>
          </div>
        </div>
      )}

      {HasStageBody && (
        <div
          key={ActiveSection.Id}
          role="tabpanel"
          aria-label={ActiveSection.Label}
          className="section-stage-body"
        >
          {ActiveSection.Content}
        </div>
      )}
    </div>
  );
}
