// Drainage solver: depression filling (Barnes priority flood), D8 steepest
// descent routing and upslope area accumulation. Cells on the raster border
// are outlets, so water leaves the map there.

import { HashUnit } from "./SeededRandom.js";

const Offsets = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Binary min-heap of cell indices keyed by a Float64Array of heights.
function CreateCellHeap(Capacity, Keys) {
  const Items = new Int32Array(Capacity);
  let Size = 0;
  return {
    Empty: () => Size === 0,
    Push(Cell) {
      let Slot = Size++;
      const Key = Keys[Cell];
      while (Slot > 0) {
        const Parent = (Slot - 1) >> 1;
        if (Keys[Items[Parent]] <= Key) break;
        Items[Slot] = Items[Parent];
        Slot = Parent;
      }
      Items[Slot] = Cell;
    },
    Pop() {
      const Top = Items[0];
      const Last = Items[--Size];
      let Slot = 0;
      const Key = Keys[Last];
      for (;;) {
        let Child = 2 * Slot + 1;
        if (Child >= Size) break;
        if (Child + 1 < Size && Keys[Items[Child + 1]] < Keys[Items[Child]]) Child++;
        if (Keys[Items[Child]] >= Key) break;
        Items[Slot] = Items[Child];
        Slot = Child;
      }
      if (Size > 0) Items[Slot] = Last;
      return Top;
    },
  };
}

// Raises every closed depression to its spill level. Epsilon gives filled flats a
// gentle gradient so routing has a unique downslope neighbour.
export function FillDepressions(Height, N, Epsilon = 0.0) {
  const Count = N * N;
  const Filled = new Float32Array(Count);
  const Closed = new Uint8Array(Count);
  const Heap = CreateCellHeap(Count, Filled);
  for (let Index = 0; Index < N; Index++) {
    for (const Cell of [Index, (N - 1) * N + Index, Index * N, Index * N + N - 1]) {
      if (Closed[Cell]) continue;
      Closed[Cell] = 1;
      Filled[Cell] = Height[Cell];
      Heap.Push(Cell);
    }
  }
  while (!Heap.Empty()) {
    const Cell = Heap.Pop();
    const X = Cell % N;
    const Y = (Cell - X) / N;
    for (const [Dx, Dy] of Offsets) {
      const Nx = X + Dx;
      const Ny = Y + Dy;
      if (Nx < 0 || Ny < 0 || Nx >= N || Ny >= N) continue;
      const Neighbour = Ny * N + Nx;
      if (Closed[Neighbour]) continue;
      Closed[Neighbour] = 1;
      Filled[Neighbour] = Math.max(Height[Neighbour], Filled[Cell] + Epsilon);
      Heap.Push(Neighbour);
    }
  }
  return Filled;
}

// D8 steepest descent. Returns the downslope cell index, or -1 for outlets.
// A hashed jitter breaks ties so routes do not run in straight diagonal lines.
export function FlowDirections(Filled, N, Cell, Seed) {
  const Direction = new Int32Array(N * N).fill(-1);
  for (let Y = 1; Y < N - 1; Y++) {
    for (let X = 1; X < N - 1; X++) {
      const Here = Y * N + X;
      let Best = -1;
      let BestDrop = 0;
      for (const [Dx, Dy] of Offsets) {
        const Neighbour = (Y + Dy) * N + (X + Dx);
        const Length = Dx !== 0 && Dy !== 0 ? Cell * Math.SQRT2 : Cell;
        const Jitter = 1 + 0.02 * (HashUnit(X * 3 + Dx, Y * 3 + Dy, Seed) - 0.5);
        const Drop = ((Filled[Here] - Filled[Neighbour]) / Length) * Jitter;
        if (Drop > BestDrop) {
          BestDrop = Drop;
          Best = Neighbour;
        }
      }
      Direction[Here] = Best;
    }
  }
  return Direction;
}

// Cell indices sorted from highest to lowest filled elevation.
export function DescendingOrder(Filled) {
  const Order = new Uint32Array(Filled.length);
  for (let Index = 0; Index < Order.length; Index++) Order[Index] = Index;
  return Order.sort((A, B) => Filled[B] - Filled[A]);
}

// Upslope contributing area in cells, including the cell itself.
export function Accumulate(Filled, Direction, Order) {
  const Area = new Float32Array(Filled.length).fill(1);
  for (let Index = 0; Index < Order.length; Index++) {
    const Here = Order[Index];
    const Downslope = Direction[Here];
    if (Downslope >= 0) Area[Downslope] += Area[Here];
  }
  return Area;
}

// Full drainage analysis for a heightfield, used by water, erosion and masks.
export function AnalyseDrainage(Height, N, Cell, Seed, Epsilon = 0.02) {
  const Filled = FillDepressions(Height, N, Epsilon);
  const Order = DescendingOrder(Filled);
  const Direction = FlowDirections(Filled, N, Cell, Seed);
  const Area = Accumulate(Filled, Direction, Order);
  return { Filled, Order, Direction, Area };
}
