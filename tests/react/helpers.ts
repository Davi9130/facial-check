import { act } from "@testing-library/react";
import { vi } from "vitest";
import { CameraManager } from "../../src/camera/CameraManager";
import { FakeStream, asStream, createVideo } from "../camera/mocks";
import { FRAME_MS, type Pose } from "../challenges/frames";
import { ManualScheduler, Scene, createAnalyzer, createEngine, flush } from "../core/harness";

/** Mocked camera, engine, analyzer and scheduler shared by the hook tests. */
export function deps() {
  const scene = new Scene();
  const scheduler = new ManualScheduler();
  let clock = 1_000_000;
  const stream = new FakeStream();
  const getUserMedia = vi.fn(async () => asStream(stream));
  const mediaDevices = { getUserMedia } as unknown as MediaDevices;
  const camera = new CameraManager({ mediaDevices });
  const engine = createEngine(scene);
  const analyzer = createAnalyzer(scene);
  const video = createVideo();
  const now = () => clock;

  /** Processes `n` frames, one every `FRAME_MS`, inside `act`. */
  async function frames(n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      clock += FRAME_MS;
      await act(async () => {
        scheduler.run();
        await flush();
      });
    }
  }

  async function play(poses: readonly (Pose | null)[]): Promise<void> {
    scene.push(poses);
    await frames(poses.length);
  }

  return { scene, scheduler, stream, getUserMedia, mediaDevices, camera, engine, analyzer, video, now, frames, play };
}

/** Lets the deferred acquisition (one microtask) and pending promises settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    await flush();
  });
}
