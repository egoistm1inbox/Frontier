#!/usr/bin/env python3
"""Generate the Remastered Studio glyph table for GlyphSymbol.cpp.

Reads GlyphPaths from the Particle/Fracture/ForceField StudioControls.js files,
unions them (reporting conflicts), converts <ellipse> elements (unsupported by
the C++ parser) into cubic path data with baked rotation, and emits a C++
table fragment with Studio- prefixed names.
"""

import math
import re
import sys

FILES = {
    "Particle": ("Experimental Remastered/ParticleEditor/StudioControls.js", "GlyphPaths = {"),
    "Fracture": ("Experimental Remastered/FractureEditor/StudioControls.js", "GlyphPaths = {"),
    "ForceField": ("Experimental Remastered/ForceFieldEditor/StudioControls.js", "GLYPH_PATHS = {"),
}


def parse(entry):
    path, anchor = entry
    text = open(path).read()
    start = text.index(anchor) + len(anchor)
    depth, i = 1, start
    while depth > 0:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    body = text[start : i - 1]
    pattern = r"^\s*(\w+):\s*'((?:[^'\\]|\\.)*)',?\s*$"
    return dict(re.findall(pattern, body, re.M))


def ellipse_to_path(cx, cy, rx, ry, rot_deg=0.0, rcx=None, rcy=None):
    if rcx is None:
        rcx, rcy = cx, cy
    kappa = 0.5522847498
    theta = math.radians(rot_deg)
    ct, st = math.cos(theta), math.sin(theta)

    def rot(x, y):
        dx, dy = x - rcx, y - rcy
        return (rcx + dx * ct - dy * st, rcy + dx * st + dy * ct)

    pts, tang = [], []
    for deg in (0, 90, 180, 270, 360):
        t = math.radians(deg)
        pts.append((cx + rx * math.cos(t), cy + ry * math.sin(t)))
        tang.append((-rx * math.sin(t) * kappa, ry * math.cos(t) * kappa))
    segs = []
    for i in range(4):
        p0, p1 = pts[i], pts[i + 1]
        c1 = (p0[0] + tang[i][0], p0[1] + tang[i][1])
        c2 = (p1[0] - tang[i + 1][0], p1[1] - tang[i + 1][1])
        p0r, c1r, c2r, p1r = rot(*p0), rot(*c1), rot(*c2), rot(*p1)
        if i == 0:
            segs.append("M%.3f %.3f C%.3f %.3f %.3f %.3f %.3f %.3f" % (p0r + c1r + c2r + p1r))
        else:
            segs.append("C%.3f %.3f %.3f %.3f %.3f %.3f" % (c1r + c2r + p1r))
    return " ".join(segs) + " Z"


ELLIPSE_RE = re.compile(r"<ellipse\s+([^/>]*)/>")


def convert_markup(markup):
    def num(attrs, name, default=0.0):
        m = re.search(name + r'="([\d.\-]+)"', attrs)
        return float(m.group(1)) if m else default

    def repl(m):
        a = m.group(1)
        cx, cy = num(a, "cx", 12), num(a, "cy", 12)
        rx, ry = num(a, "rx", 0), num(a, "ry", 0)
        t = re.search(r'transform="rotate\(([\d.\-]+)(?: ([\d.\-]+) ([\d.\-]+))?\)"', a)
        if t:
            deg = float(t.group(1))
            rcx = float(t.group(2)) if t.group(2) else cx
            rcy = float(t.group(3)) if t.group(3) else cy
        else:
            deg, rcx, rcy = 0.0, cx, cy
        return '<path d="' + ellipse_to_path(cx, cy, rx, ry, deg, rcx, rcy) + '"/>'

    return ELLIPSE_RE.sub(repl, markup).replace('"', "'")


def main():
    sets = {k: parse(v) for k, v in FILES.items()}
    print("counts:", {k: len(v) for k, v in sets.items()})
    base = dict(sets["Particle"])
    for k, v in sets["Fracture"].items():
        if k in base and base[k] != v:
            print("CONFLICT Particle/Fracture:", k)
        base[k] = v
    for k, v in sets["ForceField"].items():
        if k not in base:
            base[k] = v
            print("ForceField-only key:", k)
        elif base[k] != v:
            print("CONFLICT base/ForceField:", k)
    print("union:", len(base))
    lines = ["    // Remastered StudioControls.js GlyphPaths (Particle/Fracture/ForceField union), Studio- prefixed."]
    for name in sorted(base):
        lines.append('    {"Studio%s", "%s"},' % (name, convert_markup(base[name])))
    lines.append("    // ForceField studio icon variants (same names, different drawings), StudioField- prefixed.")
    for name in sorted(sets["ForceField"]):
        lines.append('    {"StudioField%s", "%s"},' % (name, convert_markup(sets["ForceField"][name])))
    with open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/studio_glyphs.inc", "w") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote table")


if __name__ == "__main__":
    main()
