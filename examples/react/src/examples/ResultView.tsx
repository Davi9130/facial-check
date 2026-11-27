import type { FacialCheckResult } from "facial-check";

/** Summary of a `FacialCheckResult` (it holds no image data). */
export function ResultView({ result }: { result: FacialCheckResult }) {
  return (
    <div className="result">
      <dl>
        <dt>Status</dt>
        <dd>{result.status}</dd>
        <dt>Desafios</dt>
        <dd>
          {result.challenges.passed ? "concluídos" : "não concluídos"}
          <span className="muted"> (presença, não antifraude)</span>
        </dd>
        <dt>PAD</dt>
        <dd>{result.pad ? result.pad.status : "não configurado"}</dd>
        <dt>Duração</dt>
        <dd>{result.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)} s` : "—"}</dd>
      </dl>
      <details>
        <summary>JSON completo</summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}
