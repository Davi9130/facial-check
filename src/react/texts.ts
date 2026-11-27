import type { FaceAnalysisIssue } from "../types/analysis.types";
import type { ChallengeType } from "../types/challenge.types";

/**
 * Every text shown by the React components. Defaults are in pt-BR; pass a
 * partial object (`texts` prop) to translate or reword any of them.
 */
export interface LivenessTexts {
  title: string;
  description: string;
  start: string;
  retry: string;
  loading: string;
  openingCamera: string;
  waitingFace: string;
  analyzing: string;
  success: string;
  failure: string;
  stopped: string;
  challengeDone: string;
  challengeRetry: string;
  /** `{current}` and `{total}` are replaced by the step numbers. */
  step: string;
  progressLabel: string;
  permissionDenied: string;
  cameraNotFound: string;
  cameraError: string;
  engineError: string;
  genericError: string;
  challenges: Record<ChallengeType, string>;
  issues: Record<FaceAnalysisIssue, string>;
}

export const DEFAULT_TEXTS: LivenessTexts = {
  title: "Verificação facial",
  description: "Posicione o rosto dentro da moldura e siga as instruções.",
  start: "Iniciar verificação",
  retry: "Tentar novamente",
  loading: "Carregando…",
  openingCamera: "Abrindo a câmera…",
  waitingFace: "Posicione o rosto dentro da moldura",
  analyzing: "Analisando…",
  success: "Verificação concluída",
  failure: "Não foi possível concluir a verificação",
  stopped: "Verificação interrompida",
  challengeDone: "Muito bem!",
  challengeRetry: "Não detectamos o movimento. Vamos tentar de novo.",
  step: "Etapa {current} de {total}",
  progressLabel: "Progresso da verificação",
  permissionDenied: "Permita o acesso à câmera nas configurações do navegador para continuar.",
  cameraNotFound: "Nenhuma câmera foi encontrada neste dispositivo.",
  cameraError: "Não foi possível acessar a câmera.",
  engineError: "Não foi possível carregar a detecção facial.",
  genericError: "Ocorreu um erro inesperado.",
  challenges: {
    blink: "Pisque os olhos",
    "open-mouth": "Abra a boca",
    smile: "Sorria",
    "turn-left": "Vire a cabeça para a esquerda",
    "turn-right": "Vire a cabeça para a direita",
    "head-tilt": "Incline a cabeça para o lado",
  },
  issues: {
    "no-face": "Posicione o rosto dentro da moldura",
    "multiple-faces": "Apenas uma pessoa deve aparecer na câmera",
    "not-centered": "Centralize o rosto na moldura",
    "too-close": "Afaste um pouco o rosto",
    "too-far": "Aproxime o rosto da câmera",
    "partially-visible": "Deixe o rosto inteiro visível",
    unstable: "Mantenha o rosto parado",
  },
};

/** Partial `texts` prop: nested maps can also be partial. */
export type LivenessTextsInput = Partial<Omit<LivenessTexts, "challenges" | "issues">> & {
  challenges?: Partial<LivenessTexts["challenges"]>;
  issues?: Partial<LivenessTexts["issues"]>;
};

export function resolveTexts(texts?: LivenessTextsInput): LivenessTexts {
  if (!texts) return DEFAULT_TEXTS;
  return {
    ...DEFAULT_TEXTS,
    ...texts,
    challenges: { ...DEFAULT_TEXTS.challenges, ...texts.challenges },
    issues: { ...DEFAULT_TEXTS.issues, ...texts.issues },
  } as LivenessTexts;
}

export function formatText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
