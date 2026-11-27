import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChallengeInstructions, getInstruction } from "../../src/react/ChallengeInstructions";
import { resolveTexts } from "../../src/react/texts";
import type { FacialCheckStatus } from "../../src/types/session.types";

const texts = resolveTexts();

describe("getInstruction", () => {
  it.each([
    ["initializing", texts.loading, "info"],
    ["starting", texts.openingCamera, "info"],
    ["analyzing-pad", texts.analyzing, "info"],
    ["completed", texts.success, "success"],
    ["failed", texts.failure, "warning"],
    ["stopped", texts.stopped, "info"],
    ["error", texts.genericError, "warning"],
    ["idle", texts.description, "info"],
  ] as [FacialCheckStatus, string, string][])("%s", (status, text, tone) => {
    expect(getInstruction({ status })).toEqual({ text, tone });
  });

  it("waiting-face: shows the first issue as a warning, no-face as info", () => {
    expect(getInstruction({ status: "waiting-face" })).toEqual({ text: texts.waitingFace, tone: "info" });
    expect(getInstruction({ status: "waiting-face", faceIssues: ["no-face"] })).toEqual({ text: texts.issues["no-face"], tone: "info" });
    expect(getInstruction({ status: "waiting-face", faceIssues: ["too-far", "unstable"] })).toEqual({ text: texts.issues["too-far"], tone: "warning" });
  });

  it("running: feedback first, then blocking issues, then the challenge", () => {
    expect(getInstruction({ status: "running", challenge: "blink", feedback: "done" }).tone).toBe("success");
    expect(getInstruction({ status: "running", challenge: "blink", feedback: "retry" }).text).toBe(texts.challengeRetry);
    expect(getInstruction({ status: "running", challenge: "blink", faceIssues: ["multiple-faces"] }).text).toBe(texts.issues["multiple-faces"]);
    // `unstable` is expected while moving: it does not hide the challenge.
    expect(getInstruction({ status: "running", challenge: "blink", faceIssues: ["unstable"] })).toEqual({ text: texts.challenges.blink, tone: "action" });
    expect(getInstruction({ status: "running" })).toEqual({ text: texts.waitingFace, tone: "info" });
  });
});

describe("<ChallengeInstructions>", () => {
  afterEach(cleanup);

  it("renders a polite live region with tone and challenge data attributes", () => {
    render(<ChallengeInstructions status="running" challenge="smile" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.dataset.tone).toBe("action");
    expect(el.dataset.challenge).toBe("smile");
    expect(el.textContent).toBe(texts.challenges.smile);
  });

  it("accepts custom texts and unstyled mode", () => {
    render(<ChallengeInstructions status="completed" texts={{ success: "Pronto!" }} unstyled className="x" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toBe("Pronto!");
    expect(el.className).toContain("x");
  });
});
