import type { FaceBoundingBox, FaceDetectionResult } from "../types/face.types";
import type {
  FaceAnalysis,
  FaceAnalysisIssue,
  FaceAnalyzerOptions,
  FacePositionAnalysis,
  FaceSizeAnalysis,
  FaceStabilityAnalysis,
  FaceStabilityOptions,
} from "../types/analysis.types";
import { EyeAnalyzer } from "./EyeAnalyzer";
import { HeadPoseAnalyzer } from "./HeadPoseAnalyzer";
import { MouthAnalyzer } from "./MouthAnalyzer";

const EDGE_EPSILON = 1e-3;

interface ResolvedOptions {
  readonly minScore: number;
  readonly guideX: number;
  readonly guideY: number;
  readonly guideTolerance: number;
  readonly minFaceSize: number;
  readonly maxFaceSize: number;
  readonly stability: Required<FaceStabilityOptions>;
}

interface StabilitySample {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly timestamp: number;
}

/**
 * Central facial analysis. Turns the `FaceDetectionResult`s of any engine into
 * a typed `FaceAnalysis` per frame: presence, position against a guide,
 * distance, eyes, mouth, head pose and stability over recent frames.
 *
 * Keeps only the geometry of the last few face boxes (for stability), never
 * images or landmarks. Has no UI or React dependency.
 *
 * ```ts
 * const analyzer = new FaceAnalyzer({ guide: { tolerance: 0.1 } });
 * const analysis = analyzer.analyze(await engine.detect(video), performance.now());
 * if (analysis.ready) { … }
 * ```
 */
export class FaceAnalyzer {
  readonly eyes: EyeAnalyzer;
  readonly mouth: MouthAnalyzer;
  readonly headPose: HeadPoseAnalyzer;

  private readonly options: ResolvedOptions;
  private window: StabilitySample[] = [];

  constructor(options: FaceAnalyzerOptions = {}) {
    this.options = {
      minScore: options.minScore ?? 0,
      guideX: options.guide?.centerX ?? 0.5,
      guideY: options.guide?.centerY ?? 0.5,
      guideTolerance: options.guide?.tolerance ?? 0.12,
      minFaceSize: options.minFaceSize ?? 0.25,
      maxFaceSize: options.maxFaceSize ?? 0.75,
      stability: {
        windowSize: Math.max(1, Math.floor(options.stability?.windowSize ?? 8)),
        maxMovement: options.stability?.maxMovement ?? 0.025,
        maxSizeChange: options.stability?.maxSizeChange ?? 0.08,
        maxJump: options.stability?.maxJump ?? 0.08,
        maxFrameGapMs: options.stability?.maxFrameGapMs ?? 1000,
      },
    };
    if (this.options.minFaceSize > this.options.maxFaceSize) {
      throw new RangeError("FaceAnalyzer: minFaceSize must not be greater than maxFaceSize.");
    }
    this.eyes = new EyeAnalyzer(options.eyes);
    this.mouth = new MouthAnalyzer(options.mouth);
    this.headPose = new HeadPoseAnalyzer(options.headPose);
  }

  /**
   * Analyzes one frame. Pass every face the engine returned (or `null` / `[]`
   * when there was none); the highest-scoring face is analyzed. Call once per
   * frame, in order, so the stability window stays meaningful.
   *
   * @param timestamp Frame time in milliseconds. Default: `Date.now()`.
   */
  analyze(
    faces: readonly FaceDetectionResult[] | FaceDetectionResult | null | undefined,
    timestamp: number = Date.now(),
  ): FaceAnalysis {
    const list = faces == null ? [] : Array.isArray(faces) ? faces : [faces as FaceDetectionResult];
    const candidates = list.filter((f) => f.score >= this.options.minScore);
    const face = candidates.reduce<FaceDetectionResult | null>(
      (best, f) => (best === null || f.score > best.score ? f : best),
      null,
    );

    if (!face) {
      this.window = [];
      return {
        timestamp,
        faceDetected: false,
        faceCount: 0,
        score: null,
        position: null,
        size: null,
        eyes: null,
        mouth: null,
        headPose: null,
        stability: { stable: false, frames: 0, movement: 0, sizeChange: 0, jumped: false },
        issues: ["no-face"],
        ready: false,
      };
    }

    const position = this.position(face.box);
    const size = this.size(face.box);
    const stability = this.track(face.box, timestamp);

    const issues: FaceAnalysisIssue[] = [];
    if (candidates.length > 1) issues.push("multiple-faces");
    if (!position.centered) issues.push("not-centered");
    if (size.status === "too-close") issues.push("too-close");
    if (size.status === "too-far") issues.push("too-far");
    if (!position.fullyVisible) issues.push("partially-visible");
    if (!stability.stable) issues.push("unstable");

    return {
      timestamp,
      faceDetected: true,
      faceCount: candidates.length,
      score: face.score,
      position,
      size,
      eyes: this.eyes.analyze(face),
      mouth: this.mouth.analyze(face),
      headPose: this.headPose.analyze(face),
      stability,
      issues,
      ready: issues.length === 0,
    };
  }

  /** Clears the stability window, e.g. when a new session or challenge starts. */
  reset(): void {
    this.window = [];
  }

  private position(box: FaceBoundingBox): FacePositionAnalysis {
    const o = this.options;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const offsetX = centerX - o.guideX;
    const offsetY = centerY - o.guideY;
    return {
      centerX,
      centerY,
      offsetX,
      offsetY,
      centered: Math.abs(offsetX) <= o.guideTolerance && Math.abs(offsetY) <= o.guideTolerance,
      fullyVisible:
        box.x > EDGE_EPSILON &&
        box.y > EDGE_EPSILON &&
        box.x + box.width < 1 - EDGE_EPSILON &&
        box.y + box.height < 1 - EDGE_EPSILON,
    };
  }

  private size(box: FaceBoundingBox): FaceSizeAnalysis {
    const ratio = box.height;
    const status = ratio < this.options.minFaceSize ? "too-far" : ratio > this.options.maxFaceSize ? "too-close" : "ok";
    return { ratio, status };
  }

  private track(box: FaceBoundingBox, timestamp: number): FaceStabilityAnalysis {
    const s = this.options.stability;
    const sample: StabilitySample = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      size: box.height,
      timestamp,
    };

    const previous = this.window[this.window.length - 1];
    let jumped = false;
    if (previous) {
      const gap = timestamp - previous.timestamp;
      jumped = Math.hypot(sample.x - previous.x, sample.y - previous.y) > s.maxJump;
      if (jumped || gap > s.maxFrameGapMs || gap < 0) this.window = [];
    }
    this.window.push(sample);
    if (this.window.length > s.windowSize) this.window.splice(0, this.window.length - s.windowSize);

    const n = this.window.length;
    let mx = 0;
    let my = 0;
    let msize = 0;
    for (const w of this.window) {
      mx += w.x / n;
      my += w.y / n;
      msize += w.size / n;
    }
    let movement = 0;
    let sizeChange = 0;
    for (const w of this.window) {
      movement = Math.max(movement, Math.hypot(w.x - mx, w.y - my));
      if (msize > 0) sizeChange = Math.max(sizeChange, Math.abs(w.size - msize) / msize);
    }

    return {
      stable: n >= s.windowSize && movement <= s.maxMovement && sizeChange <= s.maxSizeChange,
      frames: n,
      movement,
      sizeChange,
      jumped,
    };
  }
}
