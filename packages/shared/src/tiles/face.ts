// The tile face codec (docs/03_System_Architecture.md §4.2;
// docs/07_Tile_Model.md §5.2). Exists exactly once — `shared` is the only
// package importable by both `web` and `dealer-core`, so this is the one
// place the codec can live without being duplicated.
//
// This module knows the tile equipment's *faces* only: what a tile looks
// like. It knows nothing about copies, handles, or counts — those belong to
// tile identity (`Tile`, `TileHandle`) and to tile-set construction, which is
// dealer-core's duty (docs/07_Tile_Model.md §3.1, docs/03 §4.2). A face is
// equipment, not a rule (docs/07 §3.1).

export const DOT_FACES = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as const;
export const BAM_FACES = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"] as const;
export const CRAK_FACES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"] as const;
export const WIND_FACES = ["We", "Ws", "Ww", "Wn"] as const;
export const DRAGON_FACES = ["Rred", "Rgreen", "Rsoap"] as const;
export const FLOWER_FACES = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"] as const;
export const JOKER_FACES = ["J"] as const;

export type DotFace = (typeof DOT_FACES)[number];
export type BamFace = (typeof BAM_FACES)[number];
export type CrakFace = (typeof CRAK_FACES)[number];
export type WindFace = (typeof WIND_FACES)[number];
export type DragonFace = (typeof DRAGON_FACES)[number];
export type FlowerFace = (typeof FLOWER_FACES)[number];
export type JokerFace = (typeof JOKER_FACES)[number];

/** Every face on a physical tile (docs/07 §3, §5.2). */
export type Face = DotFace | BamFace | CrakFace | WindFace | DragonFace | FlowerFace | JokerFace;

/** The seven equipment groups, in the canonical order used for sorting (docs/07 §6). */
export type FaceGroup = "dots" | "bams" | "craks" | "winds" | "dragons" | "flowers" | "jokers";

const GROUP_ORDER: readonly FaceGroup[] = [
  "dots",
  "bams",
  "craks",
  "winds",
  "dragons",
  "flowers",
  "jokers",
];

const FACES_BY_GROUP: ReadonlyMap<FaceGroup, readonly Face[]> = new Map<FaceGroup, readonly Face[]>([
  ["dots", DOT_FACES],
  ["bams", BAM_FACES],
  ["craks", CRAK_FACES],
  ["winds", WIND_FACES],
  ["dragons", DRAGON_FACES],
  ["flowers", FLOWER_FACES],
  ["jokers", JOKER_FACES],
]);

const ALL_FACES: readonly Face[] = GROUP_ORDER.flatMap((group) => {
  const faces = FACES_BY_GROUP.get(group);
  if (faces === undefined) {
    throw new Error(`unreachable: no faces registered for group ${group}`);
  }
  return faces;
});

const FACE_SET: ReadonlySet<string> = new Set(ALL_FACES);

const GROUP_BY_FACE: ReadonlyMap<Face, FaceGroup> = new Map(
  GROUP_ORDER.flatMap((group) => {
    const faces = FACES_BY_GROUP.get(group);
    if (faces === undefined) {
      throw new Error(`unreachable: no faces registered for group ${group}`);
    }
    return faces.map((face) => [face, group] as const);
  }),
);

/** The full, ordered list of valid faces. Total: 9+9+9+4+3+8+1 = 43 distinct faces. */
export function allFaces(): readonly Face[] {
  return ALL_FACES;
}

export function isFace(value: string): value is Face {
  return FACE_SET.has(value);
}

/** Total and round-trippable: throws on anything that is not a valid face code. */
export function parseFace(value: string): Face {
  if (!isFace(value)) {
    throw new TypeError(`not a valid tile face: ${JSON.stringify(value)}`);
  }
  return value;
}

export function faceGroup(face: Face): FaceGroup {
  const group = GROUP_BY_FACE.get(face);
  if (group === undefined) {
    throw new Error(`unreachable: ${face} has no registered group`);
  }
  return group;
}

/**
 * A total order over faces: by group, then by declared position within the
 * group (docs/07 §6). Never returns 0 for distinct faces.
 */
export function compareFaces(a: Face, b: Face): number {
  if (a === b) {
    return 0;
  }
  const groupA = faceGroup(a);
  const groupB = faceGroup(b);
  if (groupA !== groupB) {
    return GROUP_ORDER.indexOf(groupA) - GROUP_ORDER.indexOf(groupB);
  }
  const withinGroup = FACES_BY_GROUP.get(groupA);
  if (withinGroup === undefined) {
    throw new Error(`unreachable: no faces registered for group ${groupA}`);
  }
  return withinGroup.indexOf(a) - withinGroup.indexOf(b);
}
