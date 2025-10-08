// FILE: backend/utils/inventoryName.js
export function normalizeSlug(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Collapse “extra/half” so they deduct from the same base stock
export function baseFoodSlug(s = "") {
  const raw = normalizeSlug(s);
  return raw.replace(/(?:extra|half)/g, "");
}

// Food counted as PIECES (but still food)
export function isFoodPieceByName(name = "") {
  const sl = normalizeSlug(name);
  // Added plastic/plastics as alias of pack(s)
  return /(moimoi|moimo|moi|plantain|dodo|pack|packs|plastic|plastics)/.test(sl);
}

export function looksProtein(name = "") {
  const sl = normalizeSlug(name);
  return /(chicken|beef|goat|turkey|fish|meat|protein|gizzard|ponmo|shaki|kote|cowleg|egg)/.test(sl);
}

export function gramsForFoodName(name = "") {
  const sl = normalizeSlug(name);
  // “extra” or “half” is 175g, otherwise a full plate 350g
  return /(extra|half)/.test(sl) ? 175 : 350;
}

// Fallback classification when item not configured
export function inferKindUnit(name = "") {
  if (isFoodPieceByName(name)) return { kind: "food", unit: "piece" };
  if (looksProtein(name)) return { kind: "protein", unit: "piece" };
  return { kind: "food", unit: "gram" };
}
