// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tile, TileGap } from "./Tile.js";

describe("Tile (docs/32_UX/Tile_Component_Spec.md)", () => {
  afterEach(() => cleanup());

  it("renders a back when no face is supplied (D-32-20)", () => {
    render(<Tile />);
    expect(screen.getByRole("button", { name: "Concealed tile" })).toBeInTheDocument();
  });

  it("renders a face's accessible name when one is supplied", () => {
    render(<Tile face="D5" />);
    expect(screen.getByRole("button", { name: "Five of dots" })).toBeInTheDocument();
  });

  it("includes position context in the accessible name (§5)", () => {
    render(<Tile face="D5" positionLabel="position 3 of 13" />);
    expect(screen.getByRole("button", { name: "Five of dots, position 3 of 13" })).toBeInTheDocument();
  });

  it("announces the armed state with the verb (§4.1, D-32-25)", () => {
    render(<Tile face="D5" armedVerb="Discard" />);
    expect(screen.getByRole("button", { name: "Discard five of dots — press Enter to confirm" })).toBeInTheDocument();
  });

  it("confirms an armed tile on Enter", async () => {
    const onActivate = vi.fn();
    render(<Tile face="D5" armedVerb="Discard" onActivate={onActivate} />);
    const user = userEvent.setup();
    const button = screen.getByRole("button");
    button.focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("calls onActivate on click", async () => {
    const onActivate = vi.fn();
    render(<Tile face="D5" onActivate={onActivate} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("marks selection via aria-pressed", () => {
    render(<Tile face="D5" selected onActivate={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("renders inert discards as a non-interactive img (D-32-26)", () => {
    render(<Tile face="D5" inert positionLabel="discard 7" />);
    const el = screen.getByRole("img", { name: "Five of dots, discard 7" });
    expect(el.tagName).not.toBe("BUTTON");
    expect(el).toHaveAttribute("aria-disabled", "true");
  });

  it("disables activation while pending", () => {
    render(<Tile face="D5" pending onActivate={() => {}} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("clamps below the 56px legibility floor (D-32-21)", () => {
    render(<Tile face="D5" heightPx={10} />);
    expect(screen.getByRole("button")).toHaveStyle({ height: "56px" });
  });

  it("renders a gap with no face and its own label (FR-101)", () => {
    render(<TileGap />);
    expect(screen.getByRole("img", { name: "Gap" })).toBeInTheDocument();
  });
});
