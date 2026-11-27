# Controlled evaluation scenarios

This is a manual test plan for running `facial-check` against real people and
common presentation attacks (photos, videos, screens, masks), in a controlled
setting. The automated suite (`npm test`) runs on synthetic data only. It shows
that the code does what it is designed to do. It does **not** show how hard the
SDK is to fool in the real world. That is what this plan measures.

> **Important — presence challenges are not PAD.**
> Blink, open-mouth, smile and head-turn challenges show that *something in
> front of the camera responds to instructions*. They do **not** show that the
> something is a live person. A replayed video, a deepfake, a 3D mask or a
> person holding a cut-out photo can pass them. Resistance to presentation
> attacks needs a **PAD** (Presentation Attack Detection) provider plugged in through
> the `pad` / `padDetector` options (`PresentationAttackDetector`), ideally one certified under
> ISO/IEC 30107-3. The scenarios below measure each layer **separately**:
> challenges alone, then challenges + PAD.

## Setup

- Use the React example (`examples/react`, from TASK 12) or a page built with `FacialCheck`,
  served over HTTPS (or `localhost`).
- Write down, for every run: device, OS, browser and version, camera
  resolution, engine (`face-api.js` / MediaPipe), the `FacialCheck` config used
  (challenges, `count`, `randomChallenges`, timeouts, thresholds), lighting (lux
  if you can measure it, or "daylight / office / dim"), distance to the camera.
- Turn on `randomChallenges: true`, as in production.
- Privacy: run sessions only with participants who gave informed consent. Keep
  results as **pass/fail plus metadata only**. Do not store images, video or
  landmarks. The SDK does not send or keep them by default; keep it that way
  in the test harness.

## Metrics

For each scenario, run at least **N = 20 attempts**, spread over several
participants and devices where it applies.

| Metric | Definition |
| --- | --- |
| Bona fide pass rate | Share of genuine attempts that end `completed` with `passed: true`. |
| BPCER (ISO 30107-3) | Bona fide presentations wrongly rejected = 1 − pass rate. |
| APCER (ISO 30107-3) | Attack presentations wrongly accepted, per attack type. |
| Time to complete | From `start()` to the `completed` event, median and p90. |
| Retries | Average `attempts` per challenge (`getResults().challenges`). |

Report APCER **per attack type and per layer**: challenges only, and
challenges + PAD.

## Scenarios

### A. Genuine users (bona fide)

| ID | Scenario | Expected |
| --- | --- | --- |
| A1 | Frontal face, good light, ~40 cm | Passes, few retries |
| A2 | Dim light / strong backlight | Passes or clear "move to better light" guidance; no false accept |
| A3 | Glasses (clear and tinted), beard, hat | Passes (tinted glasses may hurt blink) |
| A4 | Users of different ages, skin tones and face shapes | Similar pass rates across groups. Record any gap: it is a fairness issue |
| A5 | Phone held by hand (shaky), front camera | Passes; the `unstable` issue must not block challenges |
| A6 | Second person walks into the frame | `multiple-faces` guidance, no pass on the wrong face |
| A7 | User leaves the frame mid-challenge | Face-lost handling: retry or fail after `maxFaceLostMs` |
| A8 | Camera unplugged / permission revoked mid-session | `error` event with `CAMERA_ERROR`, camera released |

### B. Printed photo attacks

| ID | Scenario | Challenges only | With PAD |
| --- | --- | --- | --- |
| B1 | Printed photo held still | Must fail (no movement → timeout) | Must fail |
| B2 | Printed photo bent / rotated to mimic a head turn | May pass turn challenges | Must fail |
| B3 | Photo with the eyes / mouth cut out, a real person behind it | **May pass** blink / mouth | Must fail |

### C. Screen replay attacks

| ID | Scenario | Challenges only | With PAD |
| --- | --- | --- | --- |
| C1 | Still photo on a phone / tablet / monitor | Must fail | Must fail |
| C2 | Pre-recorded video of the user doing *every* challenge type | **May pass** when the random order happens to match, or when the attacker switches clips | Must fail |
| C3 | Live puppeted face (face-reenactment / deepfake) on a screen | **Expected to pass** | Must fail |
| C4 | Video injected as a virtual camera (OBS, v4l2loopback) | **Expected to pass**: this is outside what the camera layer can detect | Depends on the PAD / injection detection |

### D. Masks

| ID | Scenario | Challenges only | With PAD |
| --- | --- | --- | --- |
| D1 | Paper mask | Like B1/B3 | Must fail |
| D2 | Silicone / 3D mask with open eyes and mouth | **Expected to pass** | Must fail (when the PAD covers level 2 attacks) |

### E. Robustness of the challenge engine

| ID | Scenario | Expected |
| --- | --- | --- |
| E1 | User does the wrong movement (e.g. smiles when asked to blink) | The challenge does not advance |
| E2 | User does every movement at once, all the time | Does not pass faster than a normal user. Note any challenge that passes "for free" |
| E3 | Very slow / very fast movements | Pass within the configured timeouts |
| E4 | Tab hidden / phone locked mid-session | Session stops or times out cleanly, no leaked camera |

## Reading the results

- When an attack in **B/C/D** passes with *challenges only*, that does not mean
  the SDK has a bug. It is the limit described above, and it is why PAD exists.
  Record it, but do not "fix" it by making the challenge thresholds stricter:
  that raises BPCER for genuine users and gives no real protection.
- When an attack passes **with PAD**, report it to the PAD provider, with the
  scenario ID and conditions.
- When genuine users fail (**A**), tune the thresholds (`detectors`,
  `challengeSettings`, analyzer options) and re-run the whole plan, A to E.

## Result template

```text
Date:            Build/commit:
Device / OS / Browser:
Engine:          Config:
PAD provider (if any):

| ID | Layer | Attempts | Passed | Rate | Median time | Notes |
|----|-------|----------|--------|------|-------------|-------|
| A1 | challenges | 20 | 19 | 95% | 7.8 s | |
| C2 | challenges | 20 | 6  | 30% | —     | replay of a matching clip |
| C2 | + PAD      | 20 | 0  | 0%  | —     | |
```
