/* Regression: the Landing CTAs must actually drive navigation, not just exist.
 * ENGINEERING_CONTRACT.md §5.1 — both hero CTAs and the header CTA go to role
 * entry, which is the gateway to the upload flow ("Upload new survey"). */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AqualensApp } from "@/components/final/AqualensApp";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("landing CTAs reach the role-entry / upload flow", () => {
  it("exposes stable, meaningful anchors for each approved landing navigation item", () => {
    render(<AqualensApp initial="landing" />);
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/#how-it-works");
    expect(screen.getByRole("link", { name: "Evidence" })).toHaveAttribute("href", "/#evidence");
    expect(screen.getByRole("link", { name: "Datasets" })).toHaveAttribute("href", "/#datasets");
    expect(document.getElementById("how-it-works")).toBeTruthy();
    expect(document.getElementById("evidence")).toBeTruthy();
    expect(document.getElementById("datasets")).toBeTruthy();
    expect(screen.getByText("Dataset provenance")).toBeInTheDocument();
  });

  it("honours a direct landing hash after the landing route mounts", () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState({}, "", "/#datasets");

    render(<AqualensApp initial="landing" />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0].id).toBe("datasets");

    HTMLElement.prototype.scrollIntoView = original;
    window.history.replaceState({}, "", "/");
  });

  it("clicking the hero 'Try a survey' button navigates to role entry", () => {
    render(<AqualensApp initial="landing" />);
    const [heroCta] = screen.getAllByRole("button", { name: "Try a survey" });

    fireEvent.click(heroCta);

    expect(
      screen.getByText("Turn sonar surveys into actionable marine findings."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload new survey" })).toBeInTheDocument();
  });

  it("clicking the header 'Try a survey' button navigates to role entry identically", () => {
    render(<AqualensApp initial="landing" />);
    const buttons = screen.getAllByRole("button", { name: "Try a survey" });
    const headerCta = buttons[buttons.length - 1] === buttons[0] ? buttons[0] : buttons[buttons.length - 1];

    fireEvent.click(headerCta);

    expect(
      screen.getByText("Turn sonar surveys into actionable marine findings."),
    ).toBeInTheDocument();
  });

  it("clicking 'See how it works' also reaches role entry, per the frozen contract", () => {
    render(<AqualensApp initial="landing" />);
    fireEvent.click(screen.getByRole("button", { name: "See how it works" }));

    expect(
      screen.getByText("Turn sonar surveys into actionable marine findings."),
    ).toBeInTheDocument();
  });

  it("from role entry, 'Upload new survey' reaches the upload screen", () => {
    render(<AqualensApp initial="landing" />);
    const [heroCta] = screen.getAllByRole("button", { name: "Try a survey" });
    fireEvent.click(heroCta);

    fireEvent.click(screen.getByRole("button", { name: "Upload new survey" }));

    expect(screen.getByText("What survey do you want analyzed?")).toBeInTheDocument();
  });
});
