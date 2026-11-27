# facial-check — exemplos React

App de demonstração (Vite + React) do pacote `facial-check`. Importa o pacote apenas pelos entry points públicos (`facial-check` e `facial-check/react`), do mesmo jeito que um app consumidor. O pacote é instalado a partir da raiz do repositório (`"facial-check": "file:../.."`) e usa o build em `dist/`.

| Aba (rota) | O que mostra | APIs usadas |
| --- | --- | --- |
| Detecção (`#/deteccao`) | Câmera, caixa do rosto e métricas de cada frame (olhos, boca, pose, estabilidade) | `useFaceCamera`, `useFaceDetection`, `FaceCamera` |
| Captura (`#/captura`) | Foto do rosto, liberada só quando ele está centralizado, na distância certa e parado | `useFaceCamera().captureFrame`, `useFaceDetection`, `FaceGuide`, `getInstruction` |
| Desafios (`#/desafios`) | 3 desafios aleatórios, alimentados pelos frames da detecção | `useLivenessChallenges`, `useFaceDetection`, `LivenessProgress` |
| Liveness (`#/liveness`) | Fluxo completo pronto para uso, com callbacks | `FaceLiveness` |
| Headless (`#/headless`) | Interface própria sobre o hook do fluxo completo | `useFacialCheck` |
| PAD (`#/pad`) | Etapa de PAD depois dos desafios, com um provider fake que devolve o status escolhido na tela | `PresentationAttackDetector`, `PadProvider`, `FaceLiveness` (`padDetector`) |

O seletor **Engine**, no topo, troca entre `face-api.js` (padrão) e MediaPipe em todas as abas.

## Como rodar

Requisitos: Node 18+ e um navegador com câmera.

```bash
# 1. Na raiz do repositório: instalar e gerar o build do pacote
npm install
npm run build

# 2. No exemplo
cd examples/react
npm install
npm run setup   # baixa/copia os modelos para public/ (uma vez)
npm run dev     # http://localhost:5173
```

Depois de alterar o código do pacote, rode `npm run sdk:build` (ou `npm run build` na raiz) e recarregue a página.

### Modelos

`npm run setup` (`scripts/setup-models.mjs`) coloca em `public/` os arquivos descritos em [`models/README.md`](../../models/README.md):

- `public/models/`: pesos do face-api.js 0.22.2 (`tiny_face_detector`, `face_landmark_68` e `face_landmark_68_tiny`, licença MIT, baixados do repositório do face-api.js) e `face_landmarker.task` do MediaPipe (Apache 2.0, baixado do storage do Google);
- `public/mediapipe/wasm/`: runtime wasm copiado de `@mediapipe/tasks-vision`, na mesma versão usada pelo pacote.

Os arquivos não são versionados (estão no `.gitignore`). Arquivos que já existem são mantidos; use `npm run setup -- --force` para baixar de novo, por exemplo depois de atualizar `@mediapipe/tasks-vision`. Os caminhos usados pelo app ficam em `src/engine.ts`.

Só os modelos são baixados. Os frames da câmera são processados no navegador e não são enviados nem gravados.

### Câmera: localhost ou HTTPS

O navegador só libera `getUserMedia` em contexto seguro. `http://localhost` conta como seguro, então `npm run dev` funciona direto na sua máquina.

Para abrir de outro aparelho (por exemplo, um celular na mesma rede), sirva por HTTPS:

```bash
# Uma vez: gerar um certificado local confiável (https://github.com/FiloSottile/mkcert)
mkcert -install
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 ::1 <IP-da-sua-máquina>

npm run dev:https   # https://<IP-da-sua-máquina>:5173
```

No celular, o certificado só é aceito se a CA do mkcert estiver instalada nele (veja `mkcert -CAROOT`). Sem isso, o navegador mostra um aviso de segurança, que pode ser aceito manualmente para testes.

Outros scripts: `npm run build` (typecheck + build de produção em `dist/`) e `npm run preview`.

## Observações

- **Desafios não são antifraude.** Completar os movimentos só mostra que alguém fez os movimentos pedidos. Uma foto ou um vídeo pode passar. A proteção contra ataques de apresentação depende de um provider PAD real.
- **O provider da aba PAD é fake.** Ele não analisa nada e serve só para mostrar o contrato `PadProvider` e o resultado em `result.pad`. A opção "Erro no provider" mostra que uma falha vira `INCONCLUSIVE`, nunca `NO_ATTACK_DETECTED`. Um provider real que envie frames para um servidor precisa do consentimento do usuário (dado biométrico, LGPD).
- **Configuração lida na montagem.** Hooks e `FaceLiveness` leem a configuração quando montam. Por isso o app troca a `key` do exemplo ao mudar de engine (e, na aba PAD, ao mudar a resposta do provider).
- **Relógio compartilhado na aba Desafios.** O `ChallengeManager` usa `Date.now` e o `useFaceDetection` usa `performance.now` por padrão. O exemplo passa `now: Date.now` para a detecção, para que os timeouts dos desafios sejam medidos no mesmo relógio dos frames.
