import { SpaceGlowGame } from "./game.ts";

const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const startScreen = document.querySelector("#startScreen");
const endScreen = document.querySelector("#endScreen");
const hud = document.querySelector("#hud");
const debugPanel = document.querySelector("#debugPanel");
const playButton = document.querySelector("#playButton");
const demoButton = document.querySelector("#demoButton");
const helpButton = document.querySelector("#helpButton");
const closeHelpButton = document.querySelector("#closeHelpButton");
const helpDialog = document.querySelector("#helpDialog");
const restartButton = document.querySelector("#restartButton");
const downloadButton = document.querySelector("#downloadButton");
const guidancePanel = document.querySelector("#guidancePanel");
const guidanceTitle = document.querySelector("#guidanceTitle");
const guidanceBody = document.querySelector("#guidanceBody");
const levelButtons = Array.from(document.querySelectorAll(".level-button"));
const demoSeenKey = "space-glow-demo-seen-v2";

const params = new URLSearchParams(window.location.search);
const game = new SpaceGlowGame({
  width: window.innerWidth,
  height: window.innerHeight,
  seed: params.get("seed") ?? String(Date.now()),
  debug: params.get("debug") === "1",
  level: params.get("level") ?? "easy",
});

let audioContext = null;
let lastTime = performance.now();
let endScreenRendered = false;

function resize() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.resize(width, height);
}

function ensureAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  audioContext = new AudioCtor();
  return audioContext;
}

function playSound(kind) {
  if (kind === "vibrateStrong") {
    if (navigator.vibrate) navigator.vibrate([55, 35, 95, 30, 140]);
    return;
  }
  if (kind === "vibrateSoft") {
    if (navigator.vibrate) navigator.vibrate(24);
    return;
  }

  const ac = ensureAudio();
  if (!ac) return;

  if (kind === "launch") {
    tone(ac, 320, 520, 0.09, 0, "sine", 0.035);
    tone(ac, 620, 840, 0.07, 0.035, "triangle", 0.018);
  } else if (kind === "hitGraze") {
    tone(ac, 420, 520, 0.08, 0, "sine", 0.018);
  } else if (kind === "hitSolid") {
    tone(ac, 560, 760, 0.14, 0, "sine", 0.034);
    tone(ac, 840, 1120, 0.14, 0.05, "sine", 0.022);
  } else if (kind === "hitCore") {
    tone(ac, 620, 920, 0.16, 0, "triangle", 0.04);
    tone(ac, 930, 1320, 0.18, 0.06, "sine", 0.03);
    tone(ac, 1480, 1760, 0.12, 0.14, "sine", 0.018);
  } else if (kind === "hitBullseye") {
    tone(ac, 680, 980, 0.18, 0, "sine", 0.046);
    tone(ac, 1020, 1640, 0.22, 0.06, "triangle", 0.034);
    tone(ac, 1840, 2360, 0.16, 0.18, "sine", 0.022);
    noiseBurst(ac, 0.08, 0.008, 0.02);
  } else if (kind === "miss") {
    tone(ac, 190, 92, 0.2, 0, "triangle", 0.035);
    noiseBurst(ac, 0.09, 0.012, 0.03);
  } else if (kind === "rapid") {
    tone(ac, 260, 180, 0.05, 0, "square", 0.016);
  } else if (kind === "levelComplete") {
    noiseBurst(ac, 0.26, 0.036, 0);
    tone(ac, 120, 58, 0.34, 0, "sawtooth", 0.035);
    tone(ac, 330, 660, 0.42, 0.07, "sine", 0.04);
    tone(ac, 495, 990, 0.44, 0.1, "sine", 0.03);
  } else if (kind === "nextLevel") {
    tone(ac, 392, 523, 0.15, 0, "sine", 0.03);
    tone(ac, 523, 784, 0.18, 0.13, "sine", 0.026);
  } else if (kind === "demoStart" || kind === "start") {
    tone(ac, 220, 330, 0.14, 0, "sine", 0.027);
    tone(ac, 330, 495, 0.18, 0.11, "sine", 0.024);
  } else if (kind === "demoComplete") {
    tone(ac, 520, 780, 0.16, 0, "triangle", 0.026);
    tone(ac, 780, 1040, 0.18, 0.11, "sine", 0.024);
  } else if (kind === "end") {
    tone(ac, 294, 392, 0.22, 0, "sine", 0.03);
    tone(ac, 392, 587, 0.28, 0.16, "sine", 0.024);
    tone(ac, 587, 880, 0.34, 0.34, "triangle", 0.02);
  }
}

function tone(ac, startFrequency, endFrequency, duration, delay, type, volume) {
  const now = ac.currentTime + delay;
  const oscillator = ac.createOscillator();
  const gain = ac.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(ac.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.04);
}

function noiseBurst(ac, duration, volume, delay) {
  const sampleRate = ac.sampleRate;
  const frameCount = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = ac.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    const fade = 1 - i / frameCount;
    data[i] = (Math.random() * 2 - 1) * fade;
  }
  const source = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = 700;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(ac.destination);
  source.start(ac.currentTime + delay);
}

function handleInput(kind) {
  ensureAudio();
  game.tap(kind);
}

function tick(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  game.update(dt);
  for (const event of game.consumeAudioEvents()) playSound(event);
  const renderState = game.getRenderState();
  draw(renderState);
  syncUi(game.getHudState(), renderState);
  requestAnimationFrame(tick);
}

function draw(state) {
  const { width, height } = state;
  ctx.clearRect(0, 0, width, height);
  drawBackground(state);

  if (state.mode === "start" || state.mode === "ended") {
    drawAmbientNodes(state);
    return;
  }

  drawOrbit(state);
  if (state.mode !== "levelComplete") {
    drawTimingCues(state);
    drawTarget(state);
  }
  drawTrail(state);
  if (state.mode !== "levelComplete") {
    drawTether(state);
    drawParticle(state);
  }
  drawFeedback(state);
  drawExplosion(state);
  if (state.debug.enabled) drawDebugGeometry(state);
}

function drawBackground(state) {
  const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
  gradient.addColorStop(0, "#05070d");
  gradient.addColorStop(0.52, "#07111c");
  gradient.addColorStop(1, "#040609");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  for (const star of state.stars) {
    const pulse = 0.55 + Math.sin(performance.now() * 0.001 * star.pulse) * 0.25;
    ctx.globalAlpha = star.alpha * pulse;
    ctx.fillStyle = "#eaf8ff";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawAmbientNodes(state) {
  const t = performance.now() * 0.001;
  const center = { x: state.width * 0.5, y: state.height * 0.52 };
  const orbit = Math.min(state.width, state.height) * 0.16;
  const particle = {
    x: center.x + Math.cos(t * 0.55) * orbit,
    y: center.y + Math.sin(t * 0.55) * orbit,
  };
  glowCircle(center.x, center.y, 22, "rgba(115,247,255,0.95)", 36);
  ring(center.x, center.y, orbit, "rgba(115,247,255,0.24)", 1.3);
  glowCircle(particle.x, particle.y, 8, "rgba(151,255,210,0.98)", 22);
}

function drawOrbit(state) {
  ring(
    state.currentNode.x,
    state.currentNode.y,
    state.orbitRadius,
    "rgba(115,247,255,0.28)",
    1.25,
  );
  glowCircle(
    state.currentNode.x,
    state.currentNode.y,
    state.nodeRadius,
    "rgba(115,247,255,0.96)",
    34,
  );
}

function drawTimingCues(state) {
  if (!state.showTimingCues || state.launchActive) return;
  const cue = state.timingCue;
  const alpha = state.mode === "demo" ? 0.92 : 0.58;
  const arcAlpha = Math.max(0.22, cue.intensity * alpha);

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = cue.inWindow
    ? `rgba(255,244,177,${arcAlpha})`
    : `rgba(255,244,177,${arcAlpha * 0.48})`;
  ctx.lineWidth = cue.inWindow ? 5 : 3;
  ctx.beginPath();
  ctx.arc(
    state.currentNode.x,
    state.currentNode.y,
    state.orbitRadius + 8,
    cue.idealAngle - cue.windowRadians,
    cue.idealAngle + cue.windowRadians,
  );
  ctx.stroke();

  ctx.setLineDash([8, 10]);
  ctx.strokeStyle = cue.inWindow ? "rgba(255,244,177,0.76)" : "rgba(238,247,255,0.22)";
  ctx.lineWidth = cue.inWindow ? 1.8 : 1.2;
  ctx.beginPath();
  ctx.moveTo(cue.idealPoint.x, cue.idealPoint.y);
  ctx.lineTo(state.targetNode.x, state.targetNode.y);
  ctx.stroke();
  ctx.setLineDash([]);

  glowCircle(cue.idealPoint.x, cue.idealPoint.y, cue.inWindow ? 6 : 4, "rgba(255,244,177,0.96)", 18);
  if (state.mode === "demo" && cue.inWindow) {
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,244,177,0.92)";
    ctx.textAlign = "center";
    ctx.fillText("TAP", cue.idealPoint.x, cue.idealPoint.y - 18);
  }
  ctx.restore();
}

function drawTarget(state) {
  const color = state.targetColor;
  if (state.targetMotionActive && state.targetMotionPathStart && state.targetMotionPathEnd) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,244,177,0.16)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(state.targetMotionPathStart.x, state.targetMotionPathStart.y);
    ctx.lineTo(state.targetMotionPathEnd.x, state.targetMotionPathEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ring(state.targetMotionPathStart.x, state.targetMotionPathStart.y, 5, "rgba(255,244,177,0.16)", 1);
    ring(state.targetMotionPathEnd.x, state.targetMotionPathEnd.y, 5, "rgba(255,244,177,0.16)", 1);
    ctx.restore();
  }

  if (state.driftActive) {
    ring(
      state.targetOriginalPosition.x,
      state.targetOriginalPosition.y,
      state.targetRadius * 1.04,
      "rgba(255,201,111,0.16)",
      1,
    );
  }

  const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.045;
  ring(state.targetNode.x, state.targetNode.y, state.gravityRadius, "rgba(255,255,255,0.12)", 1.2);
  ring(state.targetNode.x, state.targetNode.y, state.gravityRadius * 0.72, color.ring, 1.1);
  glowCircle(
    state.targetNode.x,
    state.targetNode.y,
    state.targetRadius * 0.52 * pulse,
    color.core,
    state.mode === "demo" ? 72 : 48,
  );
  ring(
    state.targetNode.x,
    state.targetNode.y,
    state.targetRadius * pulse,
    state.targetStillDrifting ? "rgba(255,201,111,0.72)" : color.ring,
    1.6,
  );
  ring(
    state.targetNode.x,
    state.targetNode.y,
    Math.max(8, state.targetRadius * 0.24),
    "rgba(4,8,15,0.46)",
    1,
  );
}

function drawTrail(state) {
  if (state.trail.length < 2) return;
  for (let i = 1; i < state.trail.length; i += 1) {
    const a = state.trail[i - 1];
    const b = state.trail[i];
    const alpha = Math.max(0, 0.44 - b.age * 0.42);
    ctx.strokeStyle = `rgba(151,255,210,${alpha})`;
    ctx.lineWidth = Math.max(1, 6 * (1 - i / state.trail.length));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawTether(state) {
  if (state.launchActive) return;
  ctx.strokeStyle = "rgba(115,247,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(state.currentNode.x, state.currentNode.y);
  ctx.lineTo(state.particle.x, state.particle.y);
  ctx.stroke();
}

function drawParticle(state) {
  const size = Math.max(6.6, 8.5 * state.width / Math.max(state.width, 900));
  glowCircle(state.particle.x, state.particle.y, size, "rgba(238,247,255,1)", 24);
  glowCircle(state.particle.x, state.particle.y, 4.5, "rgba(255,255,255,1)", 10);
}

function drawFeedback(state) {
  for (const item of state.feedback) {
    const progress = item.age / item.life;
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle =
      item.kind === "miss"
        ? "#ff9ab0"
        : item.kind === "level" || item.kind === "bullseye"
          ? "#fff4b1"
          : item.kind === "core"
            ? "#ffc96f"
            : "#b9ffe1";
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    const labels = {
      miss: "MISS",
      level: "LEVEL CLEAR",
      bullseye: "BULLSEYE",
      core: "CORE BOOM",
      solid: "BOOM",
      graze: "GRAZE",
      catch: "CATCH",
    };
    const label = labels[item.kind] ?? "BOOM";
    ctx.fillText(label, item.x, item.y - 26 - progress * 18);
    ctx.globalAlpha = 1;
  }
}

function drawExplosion(state) {
  if (!state.explosion) return;
  const explosion = state.explosion;
  const power = explosion.power ?? 1;
  const shock = Math.min(1, explosion.age / (0.55 + power * 0.08));
  const shockRadius = 28 + shock * Math.max(120, state.gravityRadius * (1.2 + power));
  ring(
    explosion.x,
    explosion.y,
    shockRadius,
    `rgba(255,244,177,${Math.min(0.72, 0.42 + power * 0.08) * (1 - shock)})`,
    1.5 + power * 0.65,
  );
  for (const particle of explosion.particles) {
    const life = Math.max(0.001, particle.life);
    const alpha = Math.max(0, 1 - particle.age / life);
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    glowCircle(
      particle.x,
      particle.y,
      particle.radius * alpha,
      particle.color,
      (14 + power * 8) * alpha,
    );
  }
  ctx.globalAlpha = 1;
}

function drawDebugGeometry(state) {
  ctx.strokeStyle = "rgba(255,201,111,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(state.timingCue.idealPoint.x, state.timingCue.idealPoint.y);
  ctx.lineTo(state.targetNode.x, state.targetNode.y);
  ctx.stroke();
  glowCircle(state.timingCue.idealPoint.x, state.timingCue.idealPoint.y, 4, "rgba(255,201,111,0.95)", 12);
}

function glowCircle(x, y, radius, color, blur) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function ring(x, y, radius, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function syncUi(hudState, renderState) {
  const inPlay = ["demo", "running", "levelComplete"].includes(hudState.mode);
  hud.hidden = !inPlay;
  startScreen.hidden = hudState.mode !== "start";
  endScreen.hidden = hudState.mode !== "ended";
  guidancePanel.hidden = hudState.mode !== "demo";

  document.querySelector("#hudScore").textContent = String(hudState.score);
  document.querySelector("#hudCombo").textContent =
    `x${hudState.comboMultiplier.toFixed(1)} · ${hudState.streak}`;
  document.querySelector("#hudShields").textContent =
    hudState.mode === "demo" ? "Demo" : `${hudState.shields}/${hudState.maxShields}`;
  document.querySelector("#hudLevel").textContent =
    hudState.mode === "demo" ? "Demo" : `${hudState.levelIndex + 1}/${hudState.levelCount}`;
  document.querySelector("#hudProgress").textContent =
    hudState.mode === "demo"
      ? `${hudState.demoHits}/${hudState.demoTargetHits}`
      : `${Math.min(hudState.levelHits + 1, hudState.levelTargetHits)}/${hudState.levelTargetHits}`;
  const moment = document.querySelector("#hudMoment");
  moment.textContent = hudState.lastMoment?.text ?? (hudState.mode === "demo" ? "Watch the window" : "");
  moment.dataset.quality = hudState.lastMoment?.quality ?? "";

  updateLevelButtons(hudState.selectedLevelId);
  updateStartNote();
  updateGuidance(hudState, renderState);

  if (hudState.mode === "ended" && !endScreenRendered) {
    endScreenRendered = true;
    const summary = hudState.summary;
    document.querySelector("#endTitle").textContent =
      hudState.endReason === "shields-depleted" ? "Shields depleted" : "Run complete";
    document.querySelector("#endScore").textContent = `Score: ${hudState.score}`;
    document.querySelector("#endBestBoom").textContent = String(hudState.bestBoom);
    document.querySelector("#endBestStreak").textContent = String(hudState.bestStreak);
    document.querySelector("#endAccuracy").textContent = `${hudState.accuracy}%`;
    document.querySelector("#endShields").textContent = `${hudState.shields}/${hudState.maxShields}`;
    document.querySelector("#endStability").textContent =
      summary?.playerFacing?.timingStability ?? "--";
    document.querySelector("#endRecovery").textContent =
      summary?.playerFacing?.rhythmRecovery ?? "--";
  }

  const showDebug = renderState.debug.enabled && !["start", "ended"].includes(renderState.mode);
  debugPanel.hidden = !showDebug;
  if (showDebug) {
    debugPanel.textContent = [
      `mode: ${renderState.mode}`,
      `phase: ${renderState.phase?.id ?? "--"}`,
      `level: ${renderState.levelLabel} ${renderState.levelHits}/${renderState.levelTargetHits}`,
      `target: ${renderState.targetColor.label}`,
      `shields: ${renderState.shields}/${renderState.maxShields}`,
      `trial: ${renderState.debug.trialId ?? "--"} (${renderState.debug.trialPhase ?? "--"})`,
      `timing error: ${renderState.debug.timingDifferenceSeconds.toFixed(4)}s`,
      `cue window: ${renderState.timingCue.windowSeconds.toFixed(3)}s`,
      `drift scheduled: ${renderState.debug.driftScheduled}`,
      `target drifting: ${renderState.debug.targetStillDrifting}`,
      `target moving: ${renderState.debug.targetMotionActive}`,
      `score/streak: ${renderState.score}/${renderState.streak}`,
    ].join("\n");
  }
}

function updateGuidance(hudState, renderState) {
  if (hudState.mode === "demo") {
    guidanceTitle.textContent = "Demo";
    guidanceBody.textContent = renderState.timingCue.inWindow
      ? "Tap as the glow enters the window."
      : renderState.demoHits > 0
        ? "Centered hits make bigger booms."
        : "Watch the gold arc.";
  }
}

function updateLevelButtons(selectedLevelId) {
  for (const button of levelButtons) {
    const active = button.dataset.level === selectedLevelId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function updateStartNote() {
  const note = document.querySelector("#firstRunNote");
  if (!note) return;
  note.textContent = localStorage.getItem(demoSeenKey)
    ? "Choose a level and play."
    : "First play opens a guided demo, then starts your run.";
}

function formatTime(seconds) {
  const clamped = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function downloadSessionData() {
  const data = game.getSessionData();
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${data.sessionId}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function startPlay() {
  endScreenRendered = false;
  ensureAudio();
  if (!localStorage.getItem(demoSeenKey)) {
    localStorage.setItem(demoSeenKey, "1");
    game.startDemo(true);
    return;
  }
  game.startMeasured();
}

function startDemoOnly() {
  endScreenRendered = false;
  ensureAudio();
  localStorage.setItem(demoSeenKey, "1");
  game.startDemo(false);
}

window.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", () => handleInput("pointer"));
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    handleInput("spacebar");
  }
  if (event.key.toLowerCase() === "d") game.toggleDebug();
  if (event.key === "Escape" && helpDialog.open) helpDialog.close();
});

for (const button of levelButtons) {
  button.addEventListener("click", () => {
    game.setLevel(button.dataset.level);
    updateLevelButtons(button.dataset.level);
  });
}

playButton.addEventListener("click", startPlay);
demoButton.addEventListener("click", startDemoOnly);
helpButton.addEventListener("click", () => helpDialog.showModal());
closeHelpButton.addEventListener("click", () => helpDialog.close());
restartButton.addEventListener("click", () => {
  endScreenRendered = false;
  game.restart();
  startPlay();
});
downloadButton.addEventListener("click", downloadSessionData);

updateStartNote();
resize();
requestAnimationFrame(tick);
