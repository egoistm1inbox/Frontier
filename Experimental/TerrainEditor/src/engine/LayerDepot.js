// Layer depot: keeps the most recent layer outputs keyed by a content hash.
// Entries are reconstructible, so the oldest is evicted first when full.

export function CreateLayerDepot(Capacity = 24) {
  const Entries = new Map();
  return {
    Fetch(Key) {
      if (!Entries.has(Key)) return null;
      const Found = Entries.get(Key);
      Entries.delete(Key);
      Entries.set(Key, Found);
      return Found;
    },
    Store(Key, Found) {
      Entries.delete(Key);
      Entries.set(Key, Found);
      while (Entries.size > Capacity) Entries.delete(Entries.keys().next().value);
    },
    Count: () => Entries.size,
    Clear: () => Entries.clear(),
  };
}
