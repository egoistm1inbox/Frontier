// FILAMENTFIBRES.JS
// 🧩 Four looks drawn from reference stills (Follow-up 24): light threads orbiting a glass sphere, flowers built from
//    glittering particles with bokeh, a display reveal (prismatic lines behind an electric edge) and a fibre-optic wave.
// 📝 A thread is a run of capsules: instance n draws segment n mod S of thread floor(n / S), from the curve at u to
//    u + 1/S. The same per-instance trick turns some threads into sparkles riding the same curves.
//    These Track functions run inside FilamentLooks.Prelude (Hash, Flow, Spin, Sphere, palette uniforms).

// 7 · Orbits: rings of light threads around a glass sphere, Kepler-fast inside, a few spiralling in from far out.
export const Orbits = /* glsl */ `
const vec3 OrbitCentre = vec3(0.0, 1.6, 0.0);
const float OrbitSegments = 96.0;
vec3 RingFrame(vec3 P, float Fibre)
{
    float Tilt = 0.36 + (Hash(Fibre * 4.7) - 0.5) * 0.1;
    P = vec3(P.x, P.y * cos(Tilt) - P.z * sin(Tilt), P.y * sin(Tilt) + P.z * cos(Tilt));
    float Roll = -0.32 + (Hash(Fibre * 6.1) - 0.5) * 0.12;
    return OrbitCentre + vec3(P.x * cos(Roll) - P.y * sin(Roll), P.x * sin(Roll) + P.y * cos(Roll), P.z);
}
vec3 OrbitPoint(float Fibre, float U, float Time)
{
    float Radius = 1.65 + pow(Hash(Fibre * 7.91), 1.8) * 5.2;
    float Spiral = step(Hash(Fibre * 3.3), 0.16);
    float Reach = Radius * (1.0 + Spiral * pow(1.0 - U, 1.5) * 2.2);
    float Span = mix(0.6, 2.4, Hash(Fibre * 5.1)) * (1.0 + Spiral * 1.5);
    float Angle = Hash(Fibre * 2.9) * Tau + Time * uSpeed * 0.55 * pow(1.65 / Radius, 1.5) + (U - 1.0) * Span;
    float Lift = (Hash(Fibre * 8.3) - 0.5) * 0.05 * Radius;
    return RingFrame(vec3(cos(Angle) * Reach, Lift, sin(Angle) * Reach), Fibre);
}
void Track(out vec3 Head, out vec3 Tail, out vec3 Tint, out float Width, out float Glow)
{
    float Index = float(gl_InstanceID);
    float Fibre = floor(Index / OrbitSegments), Segment = mod(Index, OrbitSegments);
    if (Hash(Fibre * 9.7) < 0.08)                                                 // sparkle slot: dots on their own orbits, or loose dust
    {
        if (Hash(Index * 0.311) < 0.2)
        {
            vec3 Box = vec3(Hash(Index * 0.71), Hash(Index * 0.93), Hash(Index * 1.37)) - 0.5;
            Head = OrbitCentre + Box * vec3(22.0, 9.0, 18.0) + vec3(0.0, sin(uClock * 0.2 + Index) * 0.2, 0.0);
            Tail = Head;
            Tint = mix(uTone1, uTone2, Hash(Index * 2.1)); Width = mix(0.01, 0.03, Hash(Index * 3.7)) * uSize;
            Glow = mix(0.3, 2.0, pow(Hash(Index * 4.3), 4.0)) * (0.6 + 0.4 * sin(uClock * 2.0 + Index * 0.37));
            return;
        }
        Head = OrbitPoint(Index + 0.5, 1.0, uClock);
        Tail = OrbitPoint(Index + 0.5, 1.0, uClock - max(uTail, 0.02));
        Tint = uTone2; Width = mix(0.008, 0.024, Hash(Index * 1.9)) * uSize;
        Glow = mix(0.8, 3.5, pow(Hash(Index * 5.3), 4.0));
        return;
    }
    float From = Segment / OrbitSegments, To = (Segment + 1.0) / OrbitSegments;
    Head = OrbitPoint(Fibre, To, uClock);
    Tail = OrbitPoint(Fibre, From, uClock);
    Ramp = 0.0;
    float Pick = Hash(Fibre * 1.37);
    Tint = mix(uTone0, uTone1, Pick);
    Tint = mix(Tint, uTone2, To * To * 0.7);
    Width = mix(0.004, 0.011, Hash(Fibre * 2.3)) * uSize;
    Glow = mix(0.15, 1.1, pow(Pick, 2.0)) * pow(To, 1.2) * smoothstep(0.0, 0.08, From);
    if (Segment == OrbitSegments - 1.0) { Width *= 1.8; Glow = Glow * 2.0 + 0.4; Tint = uTone2; }
}`;

// 8 · Flora: three particle flowers (glowing petal edges, breathing open, a few motes drifting off), big leaves in the
//     foreground, fern fans behind and floating dust. Depth of field turns the near and far parts into bokeh.
export const Flora = /* glsl */ `
vec3 Tilted(vec3 P, float Angle) { return vec3(P.x, P.y * cos(Angle) - P.z * sin(Angle), P.y * sin(Angle) + P.z * cos(Angle)); }
vec3 PetalShape(float Length, float Open, float S, float T, float Time, float Ripple)
{
    float Wide = Length * 0.95 * pow(max(sin(3.14159 * S), 0.0), 0.55);
    vec3 Local = vec3(S * Length, Length * (Open * S + 0.55 * S * S) + abs(T) * Wide * 0.7, T * Wide);
    Local.y += Ripple * Length * sin(T * 12.0 + S * 7.0 + Time * 1.4);
    return Local;
}
void Track(out vec3 Head, out vec3 Tail, out vec3 Tint, out float Width, out float Glow)
{
    float Index = float(gl_InstanceID), Share = Index / uCount, Time = uClock * uSpeed;
    float Twinkle = 0.65 + 0.35 * sin(uClock * 3.0 + Hash(Index * 0.77) * 40.0);
    float S = Hash(Index * 0.513), T = Hash(Index * 0.871) - 0.5;
    if (Hash(Index * 0.239) < 0.5) T = sign(T) * (0.5 - Hash(Index * 1.13) * 0.05);    // half the points trace the edge
    Tail = vec3(0.0);
    if (Share < 0.42)                                                                  // flowers
    {
        float Roll = Hash(Index * 0.119);
        float Which = Roll < 0.5 ? 0.0 : (Roll < 0.75 ? 1.0 : 2.0);
        vec3 Centre = Which < 0.5 ? vec3(0.0, 0.7, 0.0) : (Which < 1.5 ? vec3(-3.4, 1.5, -2.8) : vec3(3.6, 1.0, -1.9));
        float Size = Which < 0.5 ? 1.7 : (Which < 1.5 ? 1.25 : 1.1);
        float Layer = step(Hash(Index * 0.331), 0.35);
        float Petal = floor(Hash(Index * 0.457) * 7.0);
        float Open = 0.22 + 0.16 * sin(Time * 0.45 + Which * 2.0) + Layer * 0.55;
        vec3 Local = PetalShape(Size * (1.0 - Layer * 0.38), Open, S, T, Time, 0.05);
        vec3 P = Spin(Local, Petal / 7.0 * Tau + Which * 1.3 + Layer * 0.45);
        if (Hash(Index * 0.613) < 0.06) P = Sphere(Hash(Index * 0.7), Hash(Index * 0.9)) * Size * 0.1 + vec3(0.0, Size * 0.08, 0.0);
        P = Centre + Tilted(P, 0.4);
        float Away = step(Hash(Index * 0.947), 0.07) * fract(Time * 0.11 + Hash(Index * 1.71));
        P += vec3(0.0, Away * 2.8, 0.0) + Flow(P * 0.8, Time) * Away * 0.9 * uTurbulence;
        Head = P; Tail = P - vec3(0.0, 2.8 * 0.11 * uSpeed, 0.0) * uTail * step(0.001, Away);
        float Rim = smoothstep(0.38, 0.5, abs(T));
        Tint = mix(uTone0, uTone1, Rim * 0.7 + S * 0.3);
        Tint = mix(Tint, uTone2, Rim * S * 0.5);
        Width = mix(0.009, 0.02, Hash(Index * 2.9)) * uSize;
        Glow = (0.25 + Rim * 0.55) * Twinkle * (1.0 - Away) + Away * 1.6 * (1.0 - Away);
    }
    else if (Share < 0.6)                                                              // foreground leaves
    {
        float Leaf = floor(Hash(Index * 0.173) * 5.0);
        vec3 Base = vec3(-4.4 + Leaf * 2.2 + (Hash(Leaf * 3.1) - 0.5), -0.7, 2.3 + Hash(Leaf * 5.7) * 1.6);
        vec3 Local = PetalShape(2.8, 0.45 + Hash(Leaf) * 0.4, S, T * 0.9, Time * 0.6, 0.03);
        Head = Base + Tilted(Spin(Local, Leaf * 1.9 + 0.8 + sin(Time * 0.3 + Leaf) * 0.06), 0.25);
        Tail = Head;
        float Rim = smoothstep(0.36, 0.48, abs(T));
        Tint = mix(uTone3, uTone0, 0.4 + Rim * 0.6);
        Width = mix(0.012, 0.022, Hash(Index * 3.1)) * uSize;
        Glow = (0.22 + Rim * 0.5) * Twinkle;
    }
    else if (Share < 0.965)                                                            // fern fans: filaments of 24 segments
    {
        float Local = Index - floor(uCount * 0.6);
        float Strand = floor(Local / 24.0), Segment = mod(Local, 24.0);
        float Fan = mod(Strand, 3.0);
        vec3 Root = Fan < 0.5 ? vec3(-3.8, 2.4, -6.0) : (Fan < 1.5 ? vec3(0.9, 3.3, -7.8) : vec3(4.8, 2.1, -5.6));
        float Spread = (Hash(Strand * 0.71) - 0.5) * 2.3 + sin(Time * 0.4 + Fan) * 0.05;
        float Length = mix(1.4, 2.3, Hash(Strand * 1.3));
        vec3 Along = vec3(sin(Spread), cos(Spread), 0.15 * sin(Spread * 2.0));
        float From = Segment / 24.0, To = (Segment + 1.0) / 24.0;
        float Droop = 0.45 * Length * abs(sin(Spread));
        Head = Root + Along * To * Length - vec3(0.0, Droop * To * To, 0.0);
        Tail = Root + Along * From * Length - vec3(0.0, Droop * From * From, 0.0);
        Ramp = 0.0;
        Tint = mix(uTone3, uTone1, To);
        Width = 0.008 * uSize * (Segment > 22.5 ? 2.5 : 1.0);
        Glow = (0.08 + 0.35 * To * To) * (Segment > 22.5 ? 3.0 : 1.0) * Twinkle;
    }
    else                                                                               // dust and bokeh motes
    {
        vec3 Box = vec3(Hash(Index * 0.61), Hash(Index * 0.83), Hash(Index * 1.07));
        vec3 P = vec3(mix(-9.0, 9.0, Box.x), mix(-1.0, 5.0, fract(Box.y + Time * 0.012)), mix(-9.0, 6.0, Box.z));
        Head = P + Flow(P * 0.3, Time * 0.5) * 0.25; Tail = Head;
        Tint = mix(uTone1, uTone2, Hash(Index * 1.9));
        Width = mix(0.008, 0.025, Hash(Index * 2.3)) * uSize;
        Glow = mix(0.5, 3.0, pow(Hash(Index * 2.7), 3.0)) * Twinkle;
    }
}`;

// 9 · Display reveal: a jagged electric front sweeps a screen. Behind it the pixel grid lights with prismatic lines;
//     at the edge pixels break off as sparks and thin wisps; ahead of it the panel is dark. uMorph = sweep 0 … 1.
export const Prism = /* glsl */ `
const vec3 PanelCentre = vec3(0.0, 2.3, 0.0);
const vec3 PanelRight = vec3(0.9131, 0.0, -0.4078);
const vec3 PanelUp = vec3(0.0, 1.0, 0.0);
const vec3 PanelOut = vec3(0.4078, 0.0, 0.9131);
void Track(out vec3 Head, out vec3 Tail, out vec3 Tint, out float Width, out float Glow)
{
    float Index = float(gl_InstanceID);
    float Columns = floor(sqrt(uCount * 1.78)), Rows = floor(uCount / Columns);
    float Column = mod(Index, Columns), Row = floor(Index / Columns);
    vec2 Spot = vec2((Column + 0.5) / Columns, (Row + 0.5) / Rows);
    vec3 Base = PanelCentre + PanelRight * (Spot.x - 0.5) * 8.0 + PanelUp * (Spot.y - 0.5) * 4.5;
    vec3 Lines = normalize(PanelRight * 0.8 - PanelUp * 0.6);
    float Sweep = Spot.x * 0.75 + (1.0 - Spot.y) * 0.5;
    float Front = mix(-0.25, 1.5, uMorph);
    float Jag = 0.07 * sin(Spot.y * 21.0 + uClock * 2.0) + 0.035 * sin(Spot.y * 53.0 - uClock * 5.0) + 0.018 * sin(Spot.x * 37.0 + Spot.y * 61.0 + uClock * 13.0);
    float Gap = Sweep + Jag - Front;                                                 // < 0: revealed
    float Speed = 1.75 * max(uMorphRate, 1e-3);
    Head = Base; Tail = Base; Width = 0.008 * uSize; Glow = 0.0; Tint = uTone0;
    if (Row >= Rows) return;
    float Roll = Hash(Index * 0.377);
    if (Gap > 0.0)                                                                   // ahead of the edge: dark, with a few wisps
    {
        if (Roll < 0.035 && Gap < 0.22)
        {
            vec3 Kink = normalize(PanelRight * (Hash(Index * 1.3) - 0.2) + PanelUp * (Hash(Index * 1.7) - 0.5) + PanelOut * 0.2);
            Head = Base + Kink * 0.09; Tail = Base;
            Tint = uTone1; Width = 0.004 * uSize;
            Glow = 0.45 * exp(-Gap * 14.0) * step(0.5, Hash(Index + floor(uClock * 14.0)));
        }
        return;
    }
    if (Roll < 0.06 && Gap > -0.3)                                                   // sparks breaking off the edge
    {
        float Age = -Gap / Speed;
        vec3 Velocity = PanelOut * 1.4 + Lines * 1.1 + (vec3(Hash(Index * 2.1), Hash(Index * 2.7), Hash(Index * 3.3)) - 0.5) * 0.8;
        Head = Base + Velocity * Age + Flow(Base * 0.9, uClock) * Age * 0.5 * uTurbulence;
        Tail = Head - Velocity * max(uTail, 0.03) * 1.5;
        Tint = mix(uTone2, uTone1, smoothstep(0.0, 1.2, Age));
        Width = mix(0.006, 0.014, Hash(Index * 4.1)) * uSize;
        Glow = 1.1 * exp(-Age * 2.2);
        return;
    }
    float Across = dot(Spot, vec2(0.6, 0.8));
    float Lane = floor(Across * 240.0);
    float Bright = pow(Hash(Lane * 0.913), 7.0);
    vec3 Hue = 0.5 + 0.5 * cos(Tau * (fract(Across * 2.2 + Hash(Lane) * 0.3) + vec3(0.0, 0.33, 0.67)));
    Head = Base + Lines * 0.2; Tail = Base; Ramp = 0.0;
    float Edge = exp(Gap * 9.0), Seam = exp(Gap * 90.0);
    float Lit = smoothstep(0.12, 0.3, Bright);                                       // about one lane in six carries a colour line
    Tint = mix(uTone0 * 0.6, Hue, mix(0.08, 0.9, Lit));
    Tint = mix(Tint, uTone1, Edge * 0.6);
    Tint = mix(Tint, uTone2, Seam);
    Glow = 0.016 + Lit * Bright * 0.3 + Edge * 0.05 + Seam * 0.35 * (0.7 + 0.3 * sin(uClock * 40.0 + Spot.y * 90.0));
}`;

// 10 · Fibre wave: a twisting sheet of optical fibres, narrow at one end and fanned out at the other, with light
//      pulses running along it and sparkles crowding the leading edge.
export const FibreWave = /* glsl */ `
const float WaveSegments = 128.0;
vec3 SheetPoint(float V, float U, float Time, float Fibre)
{
    vec3 Centre = vec3(mix(-10.0, 10.0, U), 1.5 + 1.5 * sin(U * 3.1 + Time * 0.31) + 0.6 * sin(U * 6.3 - Time * 0.47), -1.0 + 2.2 * cos(U * 2.3 + Time * 0.23));
    float Width = mix(0.4, 5.2, smoothstep(0.05, 0.92, U));
    float Twist = U * 2.6 + Time * 0.17 + 0.6;
    vec3 Across = vec3(0.0, cos(Twist), sin(Twist)), Out = vec3(0.0, -sin(Twist), cos(Twist));
    float Wander = (Hash(Fibre * 3.1) - 0.5) * 0.06 * Width + 0.04 * sin(U * 7.0 + Hash(Fibre * 5.3) * 6.0 + Time * 0.8);
    return Centre + Across * (V - 0.5) * Width + Out * Wander;
}
void Track(out vec3 Head, out vec3 Tail, out vec3 Tint, out float Width, out float Glow)
{
    float Index = float(gl_InstanceID), Time = uClock * uSpeed;
    float Fibre = floor(Index / WaveSegments), Segment = mod(Index, WaveSegments);
    float Fibres = max(1.0, floor(uCount / WaveSegments));
    float V = clamp((Fibre + Hash(Fibre * 1.7) * 0.8) / Fibres, 0.0, 1.0);
    if (Hash(Fibre * 9.3) < 0.05)                                                     // sparkle slot: dots racing along the edge fibres
    {
        float Lane = pow(Hash(Index * 0.53), 2.5);
        float U = fract(Hash(Index * 0.29) + Time * mix(0.03, 0.09, Hash(Index * 0.71)));
        Head = SheetPoint(Lane, U, Time, Index);
        Tail = SheetPoint(Lane, U - 0.004 * uSpeed, Time, Index);
        if (Hash(Index * 0.91) < 0.15) { Head += (vec3(Hash(Index * 1.1), Hash(Index * 1.3), Hash(Index * 1.9)) - 0.5) * vec3(4.0, 3.0, 3.0); Tail = Head; }
        Tint = mix(uTone1, uTone2, Hash(Index * 2.3));
        Width = mix(0.008, 0.026, pow(Hash(Index * 2.9), 2.0)) * uSize;
        Glow = mix(0.5, 3.0, pow(Hash(Index * 3.7), 3.0)) * (1.0 - Lane * 0.7) * smoothstep(0.0, 0.05, U) * smoothstep(1.0, 0.9, U);
        return;
    }
    float From = Segment / WaveSegments, To = (Segment + 1.0) / WaveSegments;
    Head = SheetPoint(V, To, Time, Fibre);
    Tail = SheetPoint(V, From, Time, Fibre);
    Ramp = 0.0;
    float EdgeLight = exp(-V * 9.0);
    float Pulse = smoothstep(0.85, 1.0, sin(To * 18.0 - Time * 2.6 + Hash(Fibre) * 6.0));
    Tint = mix(uTone3, uTone0, 0.5 + 0.5 * Hash(Fibre * 2.1));
    Tint = mix(Tint, uTone1, EdgeLight);
    Tint = mix(Tint, uTone2, Pulse * 0.6 + EdgeLight * 0.3);
    Width = mix(0.004, 0.009, Hash(Fibre * 4.3)) * uSize;
    float Strong = Hash(Fibre * 5.9) > 0.9 ? 2.2 : 1.0;
    Glow = (0.11 * Strong + EdgeLight * 1.1 + Pulse * 0.3) * smoothstep(0.0, 0.07, From) * smoothstep(1.0, 0.9, To);
}`;
