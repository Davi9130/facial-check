import { FaceCamera, getInstruction, useFacialCheck } from "facial-check/react";
import type { ExampleProps } from "../App";
import { engineOptions } from "../engine";
import { ResultView } from "./ResultView";

/**
 * Headless API: `useFacialCheck` drives camera, engine, challenges and session;
 * the whole UI below is the app's own. `FaceCamera` is just a `<video>` here;
 * a plain `<video ref={videoRef} autoPlay muted playsInline />` works too.
 */
export function HeadlessExample({ engine }: ExampleProps) {
  const { status, faceDetected, faceIssues, currentChallenge, progress, result, error, videoRef, start, stop } = useFacialCheck({
    engine,
    ...engineOptions,
    challenges: ["blink", "smile", "turn-left"],
    randomChallenges: true,
  });

  const busy = ["initializing", "starting", "waiting-face", "running", "analyzing-pad"].includes(status);
  const instruction = getInstruction({ status, challenge: currentChallenge, faceIssues });

  return (
    <div className="split">
      <div className="stage headless">
        <FaceCamera videoRef={videoRef} unstyled className="headless__camera" />
        <div className="headless__hud">
          <span className="badge" data-on={faceDetected || undefined}>{faceDetected ? "rosto" : "sem rosto"}</span>
          <span className="badge">{status}</span>
        </div>
        <p className="instruction">{instruction.text}</p>
        <div className="bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="actions">
          <button type="button" onClick={() => void start()} disabled={busy}>Iniciar</button>
          <button type="button" onClick={stop} disabled={!busy}>Parar</button>
        </div>
        {error && <p role="alert" className="error">{error.code}: {error.message}</p>}
      </div>
      <aside className="panel">
        <h2>Estado do hook</h2>
        <pre>{JSON.stringify({ status, faceDetected, faceIssues, currentChallenge, progress }, null, 2)}</pre>
        {result && result.sessionId && <ResultView result={result} />}
      </aside>
    </div>
  );
}
