import { useMemo, useState } from "react";
import {
  PresentationAttackDetector,
  type PadAnalyzeOptions,
  type PadInput,
  type PadProvider,
  type PadResult,
  type PadStatus,
  type FacialCheckResult,
} from "facial-check";
import { FaceLiveness } from "facial-check/react";
import type { ExampleProps } from "../App";
import { engineOptions } from "../engine";
import { ResultView } from "./ResultView";

/**
 * FAKE provider, for the demo only: it does not analyze anything and answers
 * the status chosen in the UI after a short delay. A real provider (local
 * model, vendor SDK, remote service) implements the same `PadProvider`
 * interface. It must never log or keep the frames; sending them to a server
 * requires the user's consent (LGPD: biometric data).
 */
class FakePadProvider implements PadProvider {
  readonly name = "fake-pad";

  constructor(
    private readonly status: PadStatus | "throw",
    private readonly delayMs = 800,
  ) {}

  async analyze(input: PadInput, { signal }: PadAnalyzeOptions): Promise<PadResult> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.delayMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    // The detector turns a throw into INCONCLUSIVE (never into NO_ATTACK_DETECTED).
    if (this.status === "throw") throw new Error("Fake provider failure");
    const frames = input.frames?.length ?? 0;
    return { status: this.status, provider: this.name, timestamp: Date.now(), message: `fake: ${frames} frame(s) recebidos` };
  }
}

const OPTIONS: { value: PadStatus | "throw"; label: string }[] = [
  { value: "NO_ATTACK_DETECTED", label: "NO_ATTACK_DETECTED" },
  { value: "PRESENTATION_ATTACK", label: "PRESENTATION_ATTACK" },
  { value: "INCONCLUSIVE", label: "INCONCLUSIVE" },
  { value: "throw", label: "Erro no provider (vira INCONCLUSIVE)" },
];

/** Liveness flow with a PAD step after the challenges. */
export function PadExample({ engine }: ExampleProps) {
  const [answer, setAnswer] = useState<PadStatus | "throw">("NO_ATTACK_DETECTED");
  const [result, setResult] = useState<FacialCheckResult | null>(null);
  const detector = useMemo(
    () => new PresentationAttackDetector({ providers: [new FakePadProvider(answer)], timeoutMs: 5000 }),
    [answer],
  );

  return (
    <div className="split">
      <FaceLiveness
        // FaceLiveness reads its configuration on mount: a new detector needs a new key.
        key={answer}
        engine={engine}
        {...engineOptions}
        challenges={["blink", "turn-left"]}
        padDetector={detector}
        pad={{ maxFrames: 2 }}
        onCompleted={setResult}
      />
      <aside className="panel">
        <label className="field">
          Resposta do provider fake
          <select value={answer} onChange={(e) => {
            setResult(null);
            setAnswer(e.target.value as PadStatus | "throw");
          }}>
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <p className="muted">
          O PAD roda depois dos desafios, sobre alguns frames guardados só em memória. O veredito sai em <code>result.pad</code>,
          separado dos desafios. <code>NO_ATTACK_DETECTED</code> não prova que o rosto é real.
        </p>
        {result && <ResultView result={result} />}
        {result?.pad && (
          <>
            <h2>result.pad</h2>
            <pre>{JSON.stringify(result.pad, null, 2)}</pre>
          </>
        )}
      </aside>
    </div>
  );
}
