import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("<Button />", () => {
  it("renders its children inside a <button> element", () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole("button", { name: /click me/i });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("forwards arbitrary props (e.g. disabled) to the underlying element", () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("applies size and variant classes", () => {
    render(
      <Button size="sm" variant="destructive">
        Delete
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /delete/i });
    expect(btn.className).toContain("min-h-8");
    expect(btn.className).toContain("bg-destructive");
  });
});
