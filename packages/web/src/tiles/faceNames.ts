// Accessible names for tile faces (docs/32_UX/Tile_Component_Spec.md §5).
// Names are descriptive, never interpretive — "Five of dots", never "five
// of dots, you have two more" (D-24-04, NR-203, D-32-29).
import { faceGroup, type Face } from "@mahjong-dealer/shared";

const NUMBER_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

const WIND_NAMES: Record<string, string> = {
  We: "East wind",
  Ws: "South wind",
  Ww: "West wind",
  Wn: "North wind",
};

const DRAGON_NAMES: Record<string, string> = {
  Rred: "Red dragon",
  Rgreen: "Green dragon",
  Rsoap: "White dragon",
};

/** Every group but flowers and jokers is a single-digit number after its prefix letter. */
function numberSuffix(face: Face): number {
  const digits = face.slice(1);
  const n = Number(digits);
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    throw new Error(`unreachable: ${face} has no valid numeric suffix`);
  }
  return n;
}

/** "Five of dots" (D-32-29): the accessible name a sighted player would also read at a glance. */
export function faceAccessibleName(face: Face): string {
  const group = faceGroup(face);
  switch (group) {
    case "dots":
      return `${NUMBER_WORDS[numberSuffix(face)]} of dots`;
    case "bams":
      return `${NUMBER_WORDS[numberSuffix(face)]} of bams`;
    case "craks":
      return `${NUMBER_WORDS[numberSuffix(face)]} of craks`;
    case "winds": {
      const name = WIND_NAMES[face];
      if (name === undefined) throw new Error(`unreachable: unknown wind face ${face}`);
      return name;
    }
    case "dragons": {
      const name = DRAGON_NAMES[face];
      if (name === undefined) throw new Error(`unreachable: unknown dragon face ${face}`);
      return name;
    }
    case "flowers":
      return `Flower ${numberSuffix(face)}`;
    case "jokers":
      return "Joker";
    default: {
      const exhaustive: never = group;
      throw new Error(`unreachable: unknown face group ${String(exhaustive)}`);
    }
  }
}

/** Mid-sentence form for armed announcements: "Discard five of dots — press Enter to confirm". */
export function faceAccessibleNameLower(face: Face): string {
  const name = faceAccessibleName(face);
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** D-32-20: a bare handle with no face renders a back, and this is what it is called. */
export const CONCEALED_TILE_NAME = "Concealed tile";
