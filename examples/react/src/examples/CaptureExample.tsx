import { useEffect, useState } from "react";
import { FaceCamera, FaceGuide, getInstruction, useFaceCamera, useFaceDetection } from "facial-check/react";
import type { ExampleProps } from "../App";
import { engineOptions } from "../engine";
import { ErrorBox } from "./shared";

/**
 * Face capture: the button is enabled only while one face is centered, at the
 * right distance and still. The photo is an object URL in memory: it is never
 * uploaded, and it is revoked when discarded or when the page closes.
 */
export function CaptureExample({ engine }: ExampleProps) {
  const camera = useFaceCamera({ autoStart: true });
  const detection = useFaceDetection({ engine, ...engineOptions, video: camera.video, enabled: camera.isActive });
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo);
  }, [photo]);

  const ready = detection.analysis?.ready ?? false;
  const issues = detection.analysis?.issues ?? [];
  const instruction = getInstruction({ status: "waiting-face", faceIssues: issues });

  const capture = () => {
    const canvas = camera.captureFrame();
    canvas.toBlob((blob) => blob && setPhoto(URL.createObjectURL(blob)), "image/jpeg", 0.9);
  };

  return (
    <div className="split">
      <div className="stage">
        <FaceCamera videoRef={camera.videoRef}>
          <FaceGuide state={!detection.faceDetected ? "searching" : ready ? "ready" : "adjust"} />
        </FaceCamera>
        <p className="instruction">{ready ? "Pronto! Pode capturar." : instruction.text}</p>
        <div className="actions">
          <button type="button" onClick={capture} disabled={!camera.isActive || !ready}>
            Capturar
          </button>
        </div>
        <ErrorBox error={camera.error} />
        <ErrorBox error={detection.error} />
      </div>
      <aside className="panel">
        {photo ? (
          <>
            {/* captureFrame() returns the raw (not mirrored) frame. */}
            <img className="photo" src={photo} alt="Foto capturada" />
            <div className="actions">
              <button type="button" onClick={() => setPhoto(null)}>Descartar</button>
            </div>
            <p className="muted">A foto existe só nesta aba. Nada foi enviado.</p>
          </>
        ) : (
          <p className="muted">Enquadre o rosto e clique em “Capturar”.</p>
        )}
      </aside>
    </div>
  );
}
