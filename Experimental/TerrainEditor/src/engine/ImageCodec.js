// Image codec: encodes raster arrays as PNG without any compression library,
// using stored deflate blocks, so it runs in Node and in a browser worker.

const CrcTable = (() => {
  const Table = new Uint32Array(256);
  for (let Index = 0; Index < 256; Index++) {
    let Value = Index;
    for (let Bit = 0; Bit < 8; Bit++) Value = Value & 1 ? 0xedb88320 ^ (Value >>> 1) : Value >>> 1;
    Table[Index] = Value >>> 0;
  }
  return Table;
})();

function Crc32(Bytes) {
  let Crc = 0xffffffff;
  for (let Index = 0; Index < Bytes.length; Index++) Crc = CrcTable[(Crc ^ Bytes[Index]) & 0xff] ^ (Crc >>> 8);
  return (Crc ^ 0xffffffff) >>> 0;
}

function Adler32(Bytes) {
  let First = 1;
  let Second = 0;
  for (let Index = 0; Index < Bytes.length; Index++) {
    First = (First + Bytes[Index]) % 65521;
    Second = (Second + First) % 65521;
  }
  return ((Second << 16) | First) >>> 0;
}

function Concatenate(Parts) {
  const Total = Parts.reduce((Sum, Part) => Sum + Part.length, 0);
  const Out = new Uint8Array(Total);
  let Offset = 0;
  for (const Part of Parts) {
    Out.set(Part, Offset);
    Offset += Part.length;
  }
  return Out;
}

function BigEndian32(Value) {
  return Uint8Array.of((Value >>> 24) & 255, (Value >>> 16) & 255, (Value >>> 8) & 255, Value & 255);
}

function Chunk(Type, Data) {
  const Typed = new TextEncoder().encode(Type);
  const Body = Concatenate([Typed, Data]);
  return Concatenate([BigEndian32(Data.length), Body, BigEndian32(Crc32(Body))]);
}

// Stored (uncompressed) zlib stream.
function ZlibStored(Raw) {
  const Blocks = [Uint8Array.of(0x78, 0x01)];
  for (let Offset = 0; Offset < Raw.length || Offset === 0; Offset += 65535) {
    const Size = Math.min(65535, Raw.length - Offset);
    const Last = Offset + Size >= Raw.length ? 1 : 0;
    Blocks.push(Uint8Array.of(Last, Size & 255, Size >>> 8, (~Size) & 255, ((~Size) >>> 8) & 255));
    Blocks.push(Raw.subarray(Offset, Offset + Size));
    if (Last) break;
  }
  Blocks.push(BigEndian32(Adler32(Raw)));
  return Concatenate(Blocks);
}

// Samples: Uint8Array (8-bit) or Uint16Array (16-bit), Channels 1 (grey) or 3 (RGB), interleaved.
export function EncodePng(Width, Height, Samples, Channels, BitDepth) {
  const Bytes = BitDepth === 16 ? 2 : 1;
  const Stride = Width * Channels * Bytes;
  const Raw = new Uint8Array((Stride + 1) * Height);
  for (let Row = 0; Row < Height; Row++) {
    const Start = Row * (Stride + 1);
    Raw[Start] = 0;
    for (let Column = 0; Column < Width * Channels; Column++) {
      const Sample = Samples[Row * Width * Channels + Column];
      if (BitDepth === 16) {
        Raw[Start + 1 + Column * 2] = (Sample >>> 8) & 255;
        Raw[Start + 2 + Column * 2] = Sample & 255;
      } else {
        Raw[Start + 1 + Column] = Sample & 255;
      }
    }
  }
  const Header = Concatenate([
    BigEndian32(Width), BigEndian32(Height),
    Uint8Array.of(BitDepth, Channels === 3 ? 2 : 0, 0, 0, 0),
  ]);
  return Concatenate([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    Chunk("IHDR", Header),
    Chunk("IDAT", ZlibStored(Raw)),
    Chunk("IEND", new Uint8Array(0)),
  ]);
}

// Maps a height raster onto 16-bit grey between Low and High metres.
export function HeightSamples(Height, Low, High) {
  const Span = High - Low || 1;
  return Uint16Array.from(Height, (Here) => Math.round(Math.min(1, Math.max(0, (Here - Low) / Span)) * 65535));
}

// Maps a 0..1 colour raster onto 8-bit RGB with sRGB encoding.
export function ColourSamples(Colour) {
  return Uint8Array.from(Colour, (Channel) => Math.round(Math.min(1, Math.max(0, Channel)) * 255));
}

// Maps a 0..1 field onto 8-bit grey.
export function UnitSamples(Field) {
  return Uint8Array.from(Field, (Here) => Math.round(Math.min(1, Math.max(0, Here)) * 255));
}
