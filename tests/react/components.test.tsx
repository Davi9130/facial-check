import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChallengeInstructions,
  DEFAULT_TEXTS,
  FaceCamera,
  FaceGuide,
  FaceLiveness,
  LivenessProgress,
  getErrorMessage,
  getInstruction,
  type FaceLivenessProps,
} from "../../src/react";
import { CameraError } from "../../src/camera/CameraErrors";
import { FacialCheckError } from "../../src/core/FacialCheckError";
import type { ChallengeType } from "../../src/types/challenge.types";
import { domError } from "../camera/mocks";
import { PERFORM, rep } from "../challenges/frames";
import { deps, settle } from "./helpers";

const TYPES: ChallengeType[] = ["blink", "open-mouth"];

function config(d: ReturnType<typeof deps>, extra: Partial<FaceLivenessProps> = {}): FaceLivenessProps {
  return {
    engine: d.engine,
    camera: d.camera,
    analyzer: d.analyzer,
    scheduler: d.scheduler,
    now: d.now,
    challenges: TYPES,
    randomChallenges: false,
    maxFps: 1000,
    createSessionId: () => "session-1",
    ...extra,
  };
}

function q<T extends Element = HTMLElement>(container: ParentNode, selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

const root = (container: HTMLElement) => q(container, ".fc-liveness");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("FaceCamera", () => {
  it("renders a muted inline <video>, mirrored by default, and forwards the ref", () => {
    const ref = vi.fn();
    const { container, rerender } = render(<FaceCamera videoRef={ref} className="mine" />);
    const video = q<HTMLVideoElement>(container, "video");
    expect(ref).toHaveBeenCalledWith(video);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.style.transform).toBe("scaleX(-1)");
    expect(container.firstElementChild?.className).toBe("fc-camera mine");

    rerender(<FaceCamera mirrored={false} />);
    expect(q<HTMLVideoElement>(container, "video").style.transform).toBe("");
  });

  it("drops default styles when unstyled", () => {
    const { container } = render(<FaceCamera unstyled style={{ width: "10px" }} />);
    expect((container.firstElementChild as HTMLElement).getAttribute("style")).toBe("width: 10px;");
  });
});

describe("FaceGuide", () => {
  it("exposes its state and draws the challenge progress", () => {
    const { container, rerender } = render(<FaceGuide state="ready" />);
    const svg = q<SVGSVGElement>(container, "svg");
    expect(svg.dataset.state).toBe("ready");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".fc-guide__progress")).toBeNull();

    rerender(<FaceGuide state="ready" progress={1.5} />);
    expect(container.querySelector(".fc-guide__progress")?.getAttribute("data-progress")).toBe("1");
  });

  it("uses a unique mask id per instance", () => {
    const { container } = render(
      <>
        <FaceGuide />
        <FaceGuide />
      </>,
    );
    const ids = [...container.querySelectorAll("mask")].map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("ChallengeInstructions / getInstruction", () => {
  it("shows the active challenge in pt-BR by default", () => {
    render(<ChallengeInstructions status="running" challenge="blink" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Pisque os olhos");
    expect(status.dataset.tone).toBe("action");
  });

  it("guides the user while waiting for a well positioned face", () => {
    expect(getInstruction({ status: "waiting-face", faceIssues: ["too-far"] })).toEqual({
      text: DEFAULT_TEXTS.issues["too-far"],
      tone: "warning",
    });
    expect(getInstruction({ status: "waiting-face" }).text).toBe(DEFAULT_TEXTS.waitingFace);
  });

  it("ignores movement-related issues during a challenge but not a lost face", () => {
    expect(getInstruction({ status: "running", challenge: "turn-left", faceIssues: ["unstable", "not-centered"] }).text).toBe(
      DEFAULT_TEXTS.challenges["turn-left"],
    );
    expect(getInstruction({ status: "running", challenge: "turn-left", faceIssues: ["no-face"] }).text).toBe(
      DEFAULT_TEXTS.issues["no-face"],
    );
  });

  it("shows per-challenge feedback", () => {
    expect(getInstruction({ status: "running", challenge: "smile", feedback: "done" }).tone).toBe("success");
    expect(getInstruction({ status: "running", challenge: "smile", feedback: "retry" }).text).toBe(DEFAULT_TEXTS.challengeRetry);
  });

  it("accepts custom texts", () => {
    render(<ChallengeInstructions status="running" challenge="smile" texts={{ challenges: { smile: "Smile!" } }} />);
    expect(screen.getByRole("status").textContent).toBe("Smile!");
  });
});

describe("LivenessProgress", () => {
  it("renders an accessible progress bar and the step label", () => {
    render(<LivenessProgress progress={50} total={4} completed={2} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("Etapa 3 de 4")).toBeTruthy();
  });

  it("clamps the value and hides the steps without a total", () => {
    render(<LivenessProgress progress={140} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.queryByText(/Etapa/)).toBeNull();
  });
});

describe("getErrorMessage", () => {
  it("has a specific message for a denied permission", () => {
    const denied = new FacialCheckError("CAMERA_ERROR", "x", { cause: new CameraError("PERMISSION_DENIED", "x") });
    expect(getErrorMessage(denied)).toBe(DEFAULT_TEXTS.permissionDenied);
    const notFound = new FacialCheckError("CAMERA_ERROR", "x", { cause: new CameraError("NOT_FOUND", "x") });
    expect(getErrorMessage(notFound)).toBe(DEFAULT_TEXTS.cameraNotFound);
    expect(getErrorMessage(new FacialCheckError("ENGINE_ERROR", "x"))).toBe(DEFAULT_TEXTS.engineError);
    expect(getErrorMessage(null)).toBe(DEFAULT_TEXTS.genericError);
  });
});

describe("FaceLiveness", () => {
  it("runs a full session: start screen → capture → success, with callbacks", async () => {
    const d = deps();
    const onSuccess = vi.fn();
    const onChallengeCompleted = vi.fn();
    const { container } = render(<FaceLiveness {...config(d, { onSuccess, onChallengeCompleted })} />);
    await settle();
    expect(root(container).dataset.phase).toBe("start");
    expect(screen.getByText(DEFAULT_TEXTS.description)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: DEFAULT_TEXTS.start }));
    });
    await settle();
    expect(d.getUserMedia).toHaveBeenCalledTimes(1);
    expect(root(container).dataset.phase).toBe("capture");

    await d.play(rep("neutral", 2));
    expect(screen.getByRole("status").textContent).toBe(DEFAULT_TEXTS.challenges.blink);
    expect(screen.getByText("Etapa 1 de 2")).toBeTruthy();

    await d.play(PERFORM.blink);
    expect(onChallengeCompleted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");

    await d.play(PERFORM["open-mouth"]);
    expect(root(container).dataset.phase).toBe("success");
    expect(screen.getByText(DEFAULT_TEXTS.success)).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0]?.[0].challenges.passed).toBe(true);
  });

  it("shows feedback when a challenge is confirmed", async () => {
    const d = deps();
    render(<FaceLiveness {...config(d, { autoStart: true, feedbackMs: 60_000 })} />);
    await settle();
    await d.play(rep("neutral", 2));
    await d.play(PERFORM.blink);
    expect(screen.getByRole("status").textContent).toBe(DEFAULT_TEXTS.challengeDone);
  });

  it("shows the permission-denied error with a retry button", async () => {
    const d = deps();
    d.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const onError = vi.fn();
    const { container } = render(<FaceLiveness {...config(d, { autoStart: true, onError })} />);
    await settle();
    await settle();
    expect(root(container).dataset.phase).toBe("error");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(DEFAULT_TEXTS.permissionDenied);
    expect(alert.dataset.permissionDenied).toBe("true");
    expect(onError).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: DEFAULT_TEXTS.retry }));
    });
    await settle();
    expect(root(container).dataset.phase).toBe("capture");
    expect(d.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("supports className, style, CSS variables, custom texts and render slots", async () => {
    const d = deps();
    const { container } = render(
      <FaceLiveness
        {...config(d)}
        className="brand"
        style={{ ["--fc-primary" as string]: "#7c3aed" }}
        classNames={{ camera: "cam", button: "btn" }}
        texts={{ start: "Começar" }}
        renderError={(error) => <p>custom: {error?.code}</p>}
      >
        {(state) => <span data-testid="slot">{state.phase}</span>}
      </FaceLiveness>,
    );
    await settle();
    const el = root(container);
    expect(el.classList.contains("brand")).toBe(true);
    expect(el.style.getPropertyValue("--fc-primary")).toBe("#7c3aed");
    expect(container.querySelector(".fc-camera.cam")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Começar" }).classList.contains("btn")).toBe(true);
    expect(screen.getByTestId("slot").textContent).toBe("start");
  });

  it("uses renderError for the error screen", async () => {
    const d = deps();
    d.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    render(<FaceLiveness {...config(d, { autoStart: true })} renderError={(error) => <p>custom: {error?.code}</p>} />);
    await settle();
    await settle();
    expect(screen.getByText("custom: CAMERA_ERROR")).toBeTruthy();
  });

  it("releases the camera on unmount", async () => {
    const d = deps();
    const { unmount } = render(<FaceLiveness {...config(d, { autoStart: true })} />);
    await settle();
    expect(d.getUserMedia).toHaveBeenCalledTimes(1);
    unmount();
    expect(d.stream.tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
  });
});
