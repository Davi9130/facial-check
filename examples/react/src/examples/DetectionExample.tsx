import { FaceCamera, useFaceCamera, useFaceDetection } from "facial-check/react";
import type { ExampleProps } from "../App";
import { engineOptions } from "../engine";
import { AnalysisTable, ErrorBox, FaceBoxes, trackAspect } from "./shared";

/** Basic detection: camera + engine loop, face boxes and live metrics. */
export function DetectionExample({ engine }: ExampleProps) {
  const camera = useFaceCamera();
  const detection = useFaceDetection({
    engine,
    ...engineOptions,
    video: camera.video,
    // Run the loop only while the camera is on.
    enabled: camera.isActive,
  });

  return (
    <div className="split">
      <div className="stage">
        <FaceCamera videoRef={camera.videoRef} style={trackAspect(camera.settings)}>
          <FaceBoxes faces={detection.faces} />
        </FaceCamera>
        <div className="actions">
          {camera.isActive ? (
            <button type="button" onClick={camera.stop}>Desligar câmera</button>
          ) : (
            <button type="button" onClick={() => void camera.start()}>Ligar câmera</button>
          )}
        </div>
        <ErrorBox error={camera.error} />
        <ErrorBox error={detection.error} />
      </div>
      <aside className="panel">
        <p>
          Câmera: <strong>{camera.status}</strong> · Engine <code>{engine}</code>: <strong>{detection.status}</strong>
        </p>
        <AnalysisTable analysis={detection.analysis} />
      </aside>
    </div>
  );
}
