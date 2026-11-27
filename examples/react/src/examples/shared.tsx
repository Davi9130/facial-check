import type { CSSProperties, ReactNode } from "react";
import type { FaceAnalysis, FaceDetectionResult } from "facial-check";

/** Aspect ratio of the camera track, so face boxes line up with the preview. */
export function trackAspect(settings: { width?: number; height?: number } | null): CSSProperties | undefined {
  return settings?.width && settings.height ? { aspectRatio: `${settings.width} / ${settings.height}` } : undefined;
}

/** Face boxes drawn over a mirrored `<FaceCamera>` (boxes are normalized to the frame). */
export function FaceBoxes({ faces, mirrored = true }: { faces: readonly FaceDetectionResult[]; mirrored?: boolean }) {
  return (
    <>
      {faces.map((face, i) => {
        const { x, y, width, height } = face.box;
        return (
          <div
            key={i}
            className="face-box"
            style={{
              left: `${(mirrored ? 1 - x - width : x) * 100}%`,
              top: `${y * 100}%`,
              width: `${width * 100}%`,
              height: `${height * 100}%`,
            }}
          >
            <span>{Math.round(face.score * 100)}%</span>
          </div>
        );
      })}
    </>
  );
}

const fmt = (value: number | null | undefined, digits = 2) => (value == null ? "—" : value.toFixed(digits));

/** Table of the per-frame metrics of a `FaceAnalysis` (no image data). */
export function AnalysisTable({ analysis }: { analysis: FaceAnalysis | null }) {
  if (!analysis) return <p className="muted">Sem frames analisados ainda.</p>;
  const rows: [string, ReactNode][] = [
    ["Rosto detectado", analysis.faceDetected ? `sim (${analysis.faceCount})` : "não"],
    ["Pronto", analysis.ready ? "sim" : "não"],
    ["Problemas", analysis.issues.length ? analysis.issues.join(", ") : "—"],
    ["Score", fmt(analysis.score)],
    ["Distância", analysis.size ? `${analysis.size.status} (${fmt(analysis.size.ratio)})` : "—"],
    ["Olhos (EAR)", analysis.eyes ? `${fmt(analysis.eyes.averageEar)}${analysis.eyes.bothClosed ? " · fechados" : ""}` : "—"],
    ["Boca (MAR)", analysis.mouth ? `${fmt(analysis.mouth.mar)}${analysis.mouth.open ? " · aberta" : ""}` : "—"],
    ["Sorriso", analysis.mouth ? `${fmt(analysis.mouth.smileScore)}${analysis.mouth.smiling ? " · sorrindo" : ""}` : "—"],
    [
      "Cabeça (yaw/pitch/roll)",
      analysis.headPose
        ? `${fmt(analysis.headPose.yaw, 0)}° / ${fmt(analysis.headPose.pitch, 0)}° / ${fmt(analysis.headPose.roll, 0)}°`
        : "—",
    ],
    ["Estável", analysis.stability.stable ? "sim" : "não"],
  ];
  return (
    <table className="metrics">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ErrorBox({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  const code = "code" in error ? ` (${String((error as { code: unknown }).code)})` : "";
  return (
    <p role="alert" className="error">
      {error.message}
      {code}
    </p>
  );
}
