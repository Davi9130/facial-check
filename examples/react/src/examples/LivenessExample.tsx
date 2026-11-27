import { useState } from "react";
import type { FacialCheckResult } from "facial-check";
import { FaceLiveness } from "facial-check/react";
import type { ExampleProps } from "../App";
import { engineOptions } from "../engine";
import { ResultView } from "./ResultView";

/** Complete flow with the ready-made component. */
export function LivenessExample({ engine }: ExampleProps) {
  const [result, setResult] = useState<FacialCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="split">
      <FaceLiveness
        engine={engine}
        {...engineOptions}
        challenges={["blink", "open-mouth", "turn-left", "turn-right"]}
        randomChallenges
        onSuccess={(r) => {
          setError(null);
          setResult(r);
        }}
        onFailure={(r) => setResult(r)}
        onError={(e) => setError(`${e.code}: ${e.message}`)}
      />
      <aside className="panel">
        <h2>Callbacks</h2>
        {error && <p role="alert" className="error">onError → {error}</p>}
        {result ? <ResultView result={result} /> : <p className="muted">O resultado de onSuccess / onFailure aparece aqui.</p>}
      </aside>
    </div>
  );
}
