import type { ChallengeState, ChallengeType } from "facial-check";
import { FaceCamera, FaceGuide, LivenessProgress, getInstruction, useFaceCamera, useFaceDetection, useLivenessChallenges } from "facial-check/react";
import type { ExampleProps } from "../App";
import { engineOptions } from "../engine";
import { ErrorBox } from "./shared";

const CHALLENGES: readonly ChallengeType[] = ["blink", "open-mouth", "smile", "turn-left", "turn-right", "head-tilt"];

const LABELS: Record<ChallengeType, string> = {
  blink: "Piscar",
  "open-mouth": "Abrir a boca",
  smile: "Sorrir",
  "turn-left": "Virar à esquerda",
  "turn-right": "Virar à direita",
  "head-tilt": "Inclinar a cabeça",
};

/**
 * Challenge engine only: the app wires its own camera and detection, and
 * feeds every analyzed frame to `useLivenessChallenges`. 3 random challenges
 * per session, out of the 6 in the catalog.
 */
export function ChallengesExample({ engine }: ExampleProps) {
  const camera = useFaceCamera({ autoStart: true });
  const challenges = useLivenessChallenges({ challenges: CHALLENGES, randomChallenges: true, count: 3 });
  const detection = useFaceDetection({
    engine,
    ...engineOptions,
    video: camera.video,
    enabled: camera.isActive,
    // Same clock as the challenge manager (Date.now), so timeouts are measured correctly.
    now: Date.now,
    onResult: (analysis) => {
      if (challenges.status === "running") challenges.update(analysis, analysis.timestamp);
    },
  });

  const running = challenges.status === "running";
  const active = challenges.challenge;
  const instruction = getInstruction({
    status: running ? "running" : "waiting-face",
    challenge: challenges.currentChallenge,
    faceIssues: detection.analysis?.issues ?? [],
  });

  return (
    <div className="split">
      <div className="stage">
        <FaceCamera videoRef={camera.videoRef}>
          <FaceGuide
            state={!detection.faceDetected ? "searching" : challenges.status === "passed" ? "success" : challenges.status === "failed" ? "error" : "ready"}
            progress={active?.status === "active" ? active.progress : undefined}
          />
        </FaceCamera>
        <p className="instruction">{running ? instruction.text : statusText(challenges.status)}</p>
        <LivenessProgress
          progress={challenges.progress}
          total={challenges.progressDetails?.total}
          completed={challenges.progressDetails?.completed}
          showSteps={challenges.progressDetails !== null}
        />
        <div className="actions">
          {running ? (
            <button type="button" onClick={() => challenges.stop()}>Parar</button>
          ) : (
            <button type="button" onClick={() => challenges.start()} disabled={!detection.faceDetected}>
              {challenges.status === "idle" ? "Iniciar desafios" : "Nova sessão"}
            </button>
          )}
        </div>
        <ErrorBox error={camera.error} />
        <ErrorBox error={detection.error} />
        <ErrorBox error={challenges.error} />
      </div>
      <aside className="panel">
        <p>
          Sessão: <code>{challenges.sessionId || "—"}</code> · <strong>{challenges.status}</strong>
        </p>
        <ol className="challenges">
          {challenges.challenges.map((c) => (
            <ChallengeRow key={`${c.sessionId}-${c.index}`} challenge={c} />
          ))}
        </ol>
        {challenges.result && (
          <p className="muted">
            Resultado: {challenges.result.passed ? "todos os movimentos foram feitos" : "sessão não concluída"}. Isso não é uma
            verificação antifraude.
          </p>
        )}
      </aside>
    </div>
  );
}

function ChallengeRow({ challenge }: { challenge: ChallengeState }) {
  return (
    <li data-status={challenge.status}>
      <span>{LABELS[challenge.type]}</span>
      <span className="muted">
        {challenge.status}
        {challenge.status === "active" && ` · ${Math.round(challenge.progress * 100)}%`} · tentativa {challenge.attempts}/
        {challenge.maxAttempts}
        {challenge.failureReason && ` · ${challenge.failureReason}`}
      </span>
    </li>
  );
}

function statusText(status: string): string {
  switch (status) {
    case "passed":
      return "Todos os desafios concluídos.";
    case "failed":
      return "Um desafio falhou. Tente de novo.";
    case "stopped":
      return "Sessão interrompida.";
    default:
      return "Enquadre o rosto e inicie os desafios.";
  }
}
