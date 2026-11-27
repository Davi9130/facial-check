import { useEffect, useState, type ComponentType } from "react";
import { CaptureExample } from "./examples/CaptureExample";
import { ChallengesExample } from "./examples/ChallengesExample";
import { DetectionExample } from "./examples/DetectionExample";
import { HeadlessExample } from "./examples/HeadlessExample";
import { LivenessExample } from "./examples/LivenessExample";
import { PadExample } from "./examples/PadExample";
import type { EngineName } from "./engine";

export interface ExampleProps {
  engine: EngineName;
}

interface Route {
  path: string;
  label: string;
  description: string;
  component: ComponentType<ExampleProps>;
}

const ROUTES: readonly Route[] = [
  {
    path: "deteccao",
    label: "Detecção",
    description: "useFaceCamera + useFaceDetection: caixa do rosto e métricas de cada frame.",
    component: DetectionExample,
  },
  {
    path: "captura",
    label: "Captura",
    description: "Captura de uma foto do rosto quando ele está enquadrado. A imagem fica só na memória da página.",
    component: CaptureExample,
  },
  {
    path: "desafios",
    label: "Desafios",
    description: "useLivenessChallenges alimentado pelos frames de useFaceDetection.",
    component: ChallengesExample,
  },
  {
    path: "liveness",
    label: "Liveness",
    description: "Fluxo completo com o componente <FaceLiveness />.",
    component: LivenessExample,
  },
  {
    path: "headless",
    label: "Headless",
    description: "Interface própria construída com o hook useFacialCheck.",
    component: HeadlessExample,
  },
  {
    path: "pad",
    label: "PAD",
    description: "Integração com um PadProvider fake via PresentationAttackDetector.",
    component: PadExample,
  },
];

function currentPath(): string {
  const path = window.location.hash.replace(/^#\/?/, "");
  return ROUTES.some((r) => r.path === path) ? path : ROUTES[0]!.path;
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const [engine, setEngine] = useState<EngineName>("face-api");

  useEffect(() => {
    const onHashChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0]!;
  const Example = route.component;

  return (
    <div className="app">
      <header className="app__header">
        <h1>facial-check</h1>
        <label className="app__engine">
          Engine
          <select value={engine} onChange={(e) => setEngine(e.target.value as EngineName)}>
            <option value="face-api">face-api.js</option>
            <option value="mediapipe">MediaPipe</option>
          </select>
        </label>
      </header>
      <nav className="tabs" aria-label="Exemplos">
        {ROUTES.map((r) => (
          <a key={r.path} href={`#/${r.path}`} className="tabs__tab" aria-current={r.path === route.path ? "page" : undefined}>
            {r.label}
          </a>
        ))}
      </nav>
      <main className="app__main">
        <p className="app__description">{route.description}</p>
        {/* A new key remounts the example: hooks read their configuration on mount. */}
        <Example key={`${route.path}:${engine}`} engine={engine} />
      </main>
      <footer className="app__footer">
        Todo o processamento acontece no navegador. Nenhuma imagem ou vídeo é enviado ou armazenado.
        Os desafios só mostram que movimentos foram feitos: não são uma verificação antifraude.
      </footer>
    </div>
  );
}
