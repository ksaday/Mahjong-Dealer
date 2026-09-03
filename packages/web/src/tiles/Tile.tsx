// The tile component (docs/32_UX/Tile_Component_Spec.md). Its one hard
// rule (§1): a face renders only when the caller supplied one. A bare
// `handle` with no `face` renders a back — there is no lookup table, no
// inference from position, and nothing else this component could show.
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { Face } from "@mahjong-dealer/shared";
import { FaceGlyph } from "./faceGlyphs.js";
import { CONCEALED_TILE_NAME, faceAccessibleName, faceAccessibleNameLower } from "./faceNames.js";

export interface TileProps {
  /** Present with a face: a face-up tile. Present without one, or entirely absent: a back (D-32-20). */
  readonly face?: Face | undefined;
  /** "position 3 of 13" / "discard 7" (Tile_Component_Spec §5). */
  readonly positionLabel?: string | undefined;
  readonly selected?: boolean;
  readonly pending?: boolean;
  /** The armed state (§4.1): outlined, with the pending verb announced. */
  readonly armedVerb?: string | undefined;
  /** Rendered but non-interactive — older discards (§4.2, D-32-26). */
  readonly inert?: boolean;
  /** Renders as an `img` with a label rather than a `button` (§5). Implied by `inert`. */
  readonly interactive?: boolean;
  readonly onActivate?: (() => void) | undefined;
  /** 56–96px; below 56 the caller should scroll rather than shrink further (D-32-21). */
  readonly heightPx?: number;
}

const MIN_HEIGHT = 56;
const DEFAULT_HEIGHT = 72;

export function Tile({
  face,
  positionLabel,
  selected = false,
  pending = false,
  armedVerb,
  inert = false,
  interactive = true,
  onActivate,
  heightPx = DEFAULT_HEIGHT,
}: TileProps) {
  const height = Math.max(MIN_HEIGHT, heightPx);
  const width = height * 0.75;
  const armed = armedVerb !== undefined;
  const isBack = face === undefined;
  const canActivate = interactive && !inert;

  const baseName = isBack ? CONCEALED_TILE_NAME : faceAccessibleName(face);
  const label = armed
    ? `${armedVerb} ${isBack ? CONCEALED_TILE_NAME.toLowerCase() : faceAccessibleNameLower(face)} — press Enter to confirm`
    : positionLabel !== undefined
      ? `${baseName}, ${positionLabel}`
      : baseName;

  const style: CSSProperties = {
    height,
    width,
    ["--tile-height" as string]: `${height}px`,
  };

  const classNames = ["tile", isBack ? "tile-back" : "tile-face", selected ? "tile-selected" : "", armed ? "tile-armed" : "", pending ? "tile-pending" : "", inert ? "tile-inert" : ""]
    .filter(Boolean)
    .join(" ");

  const content: ReactNode = isBack ? (
    <span className="tile-back-pattern" aria-hidden="true" />
  ) : (
    <svg viewBox="0 0 100 100" className="tile-glyph" aria-hidden="true">
      <FaceGlyph face={face} />
    </svg>
  );

  const armedCaption = armed ? (
    <span className="tile-armed-caption" aria-hidden="true">
      {armedVerb}?
    </span>
  ) : null;

  if (!canActivate) {
    return (
      <span className={classNames} style={style} role="img" aria-label={label} aria-disabled={inert || undefined}>
        {content}
        {pending && <span className="tile-spinner" aria-hidden="true" />}
      </span>
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    // Enter confirms an armed tile; the button's own click handling covers
    // Enter/Space activation for everything else (native <button> behaviour).
    if (armed && event.key === "Enter") {
      event.preventDefault();
      onActivate?.();
    }
  }

  return (
    <button
      type="button"
      className={classNames}
      style={style}
      aria-label={label}
      aria-pressed={selected}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      disabled={pending}
    >
      {content}
      {armedCaption}
      {pending && <span className="tile-spinner" aria-hidden="true" />}
    </button>
  );
}

/** A rack gap the player deliberately left (docs/33_API §5.2, FR-101) — same footprint, no face. */
export function TileGap({ heightPx = DEFAULT_HEIGHT }: { readonly heightPx?: number }) {
  const height = Math.max(MIN_HEIGHT, heightPx);
  const width = height * 0.75;
  return <span className="tile-gap" style={{ height, width }} role="img" aria-label="Gap" />;
}
