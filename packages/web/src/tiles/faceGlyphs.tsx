// Vector glyphs for every tile face (docs/32_UX/Tile_Component_Spec.md §3).
// Vector artwork, not raster, so faces stay crisp from 56px to 300% zoom
// (D-32-24). Dragons and the soap are distinct *shapes*, not distinguished
// by colour alone (D-32-22, D-32-23) — colour here is a redundant second
// channel, never the only one.
//
// Everything renders into a shared 0 0 100 100 viewBox; `Tile` positions
// and insets it per the component spec's dimensions table.
import type { ReactElement } from "react";
import { faceGroup, type Face } from "@mahjong-dealer/shared";

const GRID = [20, 50, 80];

/** Classic mahjong dot layouts for 1–9, as [row, col] indices into `GRID`. */
const DOT_PATTERNS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
  7: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
  8: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  9: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
};

function numberSuffix(face: string): number {
  return Number(face.slice(1));
}

function Dots({ n }: { readonly n: number }) {
  const pattern = DOT_PATTERNS[n];
  if (pattern === undefined) throw new Error(`unreachable: no dot pattern for ${n}`);
  return (
    <>
      {pattern.map(([row, col], i) => (
        <circle key={i} cx={GRID[col]} cy={GRID[row]} r={n <= 3 ? 11 : 8.5} fill="currentColor" />
      ))}
    </>
  );
}

/** A single bamboo stick: a stalk with two joint rings, distinct from a dot or a bar. */
function BambooStick({ x, y, scale = 1 }: { readonly x: number; readonly y: number; readonly scale?: number }) {
  const h = 20 * scale;
  const w = 7 * scale;
  return (
    <g stroke="currentColor" strokeWidth={1.6 * scale} fill="none">
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={w / 2} />
      <line x1={x - w / 2} y1={y - h / 6} x2={x + w / 2} y2={y - h / 6} />
      <line x1={x - w / 2} y1={y + h / 6} x2={x + w / 2} y2={y + h / 6} />
    </g>
  );
}

/** The traditional bird glyph for one bam — distinct from every bamboo-stick count (Tile_Component_Spec §3.1). */
function BambooBird() {
  return (
    <g fill="currentColor">
      <ellipse cx="50" cy="56" rx="20" ry="14" />
      <circle cx="34" cy="42" r="9" />
      <path d="M 25 40 L 14 36 L 25 46 Z" />
      <path d="M 62 62 L 78 70 L 60 74 Z" />
      <path d="M 44 68 L 38 84 L 48 78 Z" />
      <path d="M 58 68 L 64 84 L 54 78 Z" />
    </g>
  );
}

function Bams({ n }: { readonly n: number }) {
  if (n === 1) return <BambooBird />;
  const pattern = DOT_PATTERNS[n];
  if (pattern === undefined) throw new Error(`unreachable: no bam layout for ${n}`);
  const scale = n <= 3 ? 1.5 : n <= 6 ? 1.15 : 0.95;
  return (
    <>
      {pattern.map(([row, col], i) => (
        <BambooStick key={i} x={GRID[col]!} y={GRID[row]!} scale={scale} />
      ))}
    </>
  );
}

function Craks({ n }: { readonly n: number }) {
  return (
    <g fill="currentColor" textAnchor="middle" fontFamily="serif">
      <text x="50" y="38" fontSize="22" fontWeight="700">
        {n}
      </text>
      <text x="50" y="76" fontSize="34">
        萬
      </text>
    </g>
  );
}

const WIND_LETTER: Readonly<Record<string, string>> = { We: "E", Ws: "S", Ww: "W", Wn: "N" };

function Wind({ face }: { readonly face: string }) {
  const letter = WIND_LETTER[face];
  if (letter === undefined) throw new Error(`unreachable: unknown wind face ${face}`);
  return (
    <text x="50" y="66" fontSize="52" fontWeight="700" textAnchor="middle" fill="currentColor" fontFamily="system-ui, sans-serif">
      {letter}
    </text>
  );
}

function RedDragon() {
  return (
    <text x="50" y="68" fontSize="46" textAnchor="middle" fill="currentColor" fontFamily="serif">
      中
    </text>
  );
}

function GreenDragon() {
  return (
    <text x="50" y="68" fontSize="42" textAnchor="middle" fill="currentColor" fontFamily="serif">
      發
    </text>
  );
}

/** The soap: a distinct framed-plaque glyph, never a truly blank face (D-32-23). */
function SoapDragon() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="3">
      <rect x="22" y="22" width="56" height="56" rx="10" />
      <rect x="32" y="32" width="36" height="36" rx="6" />
    </g>
  );
}

function Dragon({ face }: { readonly face: string }) {
  if (face === "Rred") return <RedDragon />;
  if (face === "Rgreen") return <GreenDragon />;
  if (face === "Rsoap") return <SoapDragon />;
  throw new Error(`unreachable: unknown dragon face ${face}`);
}

/** Eight distinct, simple flower icons — no rule meaning attaches to any of them (docs/07 §3.2). */
const FLOWER_ICONS: readonly (() => ReactElement)[] = [
  () => (
    <g fill="currentColor">
      {[0, 72, 144, 216, 288].map((deg) => (
        <ellipse key={deg} cx="50" cy="30" rx="9" ry="16" transform={`rotate(${deg} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    </g>
  ),
  () => (
    <g fill="none" stroke="currentColor" strokeWidth="3">
      {[0, 90, 180, 270].map((deg) => (
        <path key={deg} d="M 50 50 Q 62 38 50 22 Q 38 38 50 50" transform={`rotate(${deg} 50 50)`} />
      ))}
    </g>
  ),
  () => (
    <g fill="currentColor">
      <circle cx="50" cy="26" r="8" />
      <circle cx="70" cy="42" r="8" />
      <circle cx="62" cy="66" r="8" />
      <circle cx="38" cy="66" r="8" />
      <circle cx="30" cy="42" r="8" />
      <circle cx="50" cy="46" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    </g>
  ),
  () => (
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
      <path d="M 50 78 L 50 30" />
      <path d="M 50 46 Q 30 40 26 20" />
      <path d="M 50 58 Q 70 52 74 32" />
    </g>
  ),
  () => (
    <g fill="currentColor">
      <circle cx="50" cy="50" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <rect key={deg} x="48" y="16" width="4" height="12" transform={`rotate(${deg} 50 50)`} />
      ))}
    </g>
  ),
  () => (
    <g fill="currentColor">
      <path d="M 50 20 L 60 44 L 86 44 L 65 58 L 73 82 L 50 67 L 27 82 L 35 58 L 14 44 L 40 44 Z" />
    </g>
  ),
  () => (
    <g fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M 50 78 Q 20 60 26 30 Q 50 40 50 78 Q 80 60 74 30 Q 50 40 50 78" />
    </g>
  ),
  () => (
    <g fill="currentColor">
      <path d="M 50 22 C 66 22 72 36 66 46 C 78 46 84 60 74 68 C 66 78 52 76 50 62 C 48 76 34 78 26 68 C 16 60 22 46 34 46 C 28 36 34 22 50 22 Z" fillOpacity="0" stroke="currentColor" strokeWidth="3" />
      <circle cx="50" cy="50" r="6" />
    </g>
  ),
];

function Flower({ n }: { readonly n: number }) {
  const Icon = FLOWER_ICONS[n - 1];
  if (Icon === undefined) throw new Error(`unreachable: no flower icon for ${n}`);
  return <Icon />;
}

/** A four-pointed star, unlike any suit or honour glyph (D-32-... — distinct from every other face). */
function Joker() {
  return (
    <path
      d="M 50 12 C 52 34 40 48 18 50 C 40 52 52 66 50 88 C 48 66 60 52 82 50 C 60 48 48 34 50 12 Z"
      fill="currentColor"
    />
  );
}

/** The one entry point: every face's glyph, on a shared 0 0 100 100 canvas. */
export function FaceGlyph({ face }: { readonly face: Face }) {
  const group = faceGroup(face);
  switch (group) {
    case "dots":
      return <Dots n={numberSuffix(face)} />;
    case "bams":
      return <Bams n={numberSuffix(face)} />;
    case "craks":
      return <Craks n={numberSuffix(face)} />;
    case "winds":
      return <Wind face={face} />;
    case "dragons":
      return <Dragon face={face} />;
    case "flowers":
      return <Flower n={numberSuffix(face)} />;
    case "jokers":
      return <Joker />;
    default: {
      const exhaustive: never = group;
      throw new Error(`unreachable: unknown face group ${String(exhaustive)}`);
    }
  }
}
