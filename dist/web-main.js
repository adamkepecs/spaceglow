import { SpaceGlowGame } from "./game.js";

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
let lastHudScore = 0;

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
  const ac = ensureAudio();
  if (!ac) return;

  if (kind === "launch") {
    tone(ac, 320, 520, 0.09, 0, "sine", 0.035);
    tone(ac, 620, 840, 0.07, 0.035, "triangle", 0.018);
  } else if (kind === "graze" || kind === "hitGraze") {
    tone(ac, 420, 520, 0.08, 0, "sine", 0.018);
  } else if (kind === "hit" || kind === "hitSolid") {
    tone(ac, 560, 760, 0.14, 0, "sine", 0.034);
    tone(ac, 840, 1120, 0.14, 0.05, "sine", 0.022);
  } else if (kind === "core" || kind === "hitCore") {
    if (navigator.vibrate) navigator.vibrate(35);
    tone(ac, 620, 920, 0.16, 0, "triangle", 0.04);
    tone(ac, 930, 1320, 0.18, 0.06, "sine", 0.03);
    tone(ac, 1480, 1760, 0.12, 0.14, "sine", 0.018);
  } else if (kind === "bullseye" || kind === "hitBullseye") {
    if (navigator.vibrate) navigator.vibrate(50);
    tone(ac, 680, 980, 0.18, 0, "sine", 0.046);
    tone(ac, 1020, 1640, 0.22, 0.06, "triangle", 0.034);
    tone(ac, 1840, 2360, 0.16, 0.18, "sine", 0.022);
    noiseBurst(ac, 0.08, 0.008, 0.02);
  } else if (kind === "miss") {
    if (navigator.vibrate) navigator.vibrate(20);
    tone(ac, 190, 92, 0.2, 0, "triangle", 0.035);
    noiseBurst(ac, 0.09, 0.012, 0.03);
  } else if (kind === "blocked" || kind === "rapid") {
    tone(ac, 230, 180, 0.045, 0, "sine", 0.014);
  } else if (kind === "shieldLost") {
    tone(ac, 240, 140, 0.1, 0, "triangle", 0.024);
  } else if (kind === "shieldGained") {
    tone(ac, 520, 760, 0.1, 0, "sine", 0.02);
    tone(ac, 760, 1040, 0.08, 0.06, "sine", 0.014);
  } else if (kind === "streakBonus") {
    tone(ac, 660, 990, 0.12, 0, "triangle", 0.032);
    tone(ac, 990, 1320, 0.12, 0.08, "sine", 0.024);
  } else if (kind === "overdriveStart") {
    tone(ac, 220, 440, 0.18, 0, "sawtooth", 0.03);
    tone(ac, 660, 1320, 0.22, 0.08, "triangle", 0.026);
    noiseBurst(ac, 0.12, 0.012, 0.04);
  } else if (kind === "bonus") {
    tone(ac, 880, 1320, 0.09, 0, "sine", 0.024);
    tone(ac, 1320, 1760, 0.08, 0.07, "sine", 0.018);
  } else if (kind === "levelClear" || kind === "levelComplete") {
    if (navigator.vibrate) navigator.vibrate(80);
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
  ctx.save();
  if (state.screenShake?.remaining > 0) {
    const progress = state.screenShake.remaining / Math.max(0.001, state.screenShake.duration);
    const intensity = state.screenShake.intensity * progress;
    const t = performance.now() * 0.09;
    ctx.translate(Math.sin(t) * intensity, Math.cos(t * 1.37) * intensity);
  }
  drawBackground(state);

  if (state.mode === "start" || state.mode === "ended") {
    drawAmbientNodes(state);
    ctx.restore();
    return;
  }

  drawOrbit(state);
  if (state.mode !== "levelComplete") {
    drawTimingCues(state);
    drawTarget(state);
    drawBonusComet(state);
  }
  drawTrail(state);
  drawMissGhost(state);
  if (state.mode !== "levelComplete") {
    drawTether(state);
    drawParticle(state);
  }
  drawFeedback(state);
  drawExplosion(state);
  drawLevelBanner(state);
  if (state.debug.enabled) drawDebugGeometry(state);
  ctx.restore();
}

function drawBackground(state) {
  const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
  gradient.addColorStop(0, "#05070d");
  gradient.addColorStop(0.52, "#07111c");
  gradient.addColorStop(1, "#040609");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  const t = performance.now() * 0.00025;
  drawNebula(state.width * 0.18, state.height * 0.28, state.width * 0.46, `rgba(115,247,255,${0.045 + Math.sin(t) * 0.01})`);
  drawNebula(state.width * 0.82, state.height * 0.72, state.width * 0.38, `rgba(255,156,72,${0.035 + Math.cos(t * 1.2) * 0.008})`);
  drawNebula(state.width * 0.54, state.height * 0.42, state.width * 0.3, `rgba(151,255,210,${0.026 + Math.sin(t * 1.7) * 0.006})`);

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

function drawNebula(x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
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
  const approachPulse = 0.68 + cue.intensity * 0.52 + Math.sin(performance.now() * 0.01) * 0.08;
  const alpha = (state.mode === "demo" ? 0.96 : 0.82) * (cue.flickerAlpha ?? 1);
  const arcAlpha = Math.max(0.34, cue.intensity * alpha);

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = cue.inWindow
    ? `rgba(255,244,177,${Math.min(1, arcAlpha + 0.18)})`
    : `rgba(255,201,111,${arcAlpha * approachPulse})`;
  ctx.shadowColor = "rgba(255,244,177,0.7)";
  ctx.shadowBlur = cue.inWindow ? 18 : 8 + cue.intensity * 14;
  ctx.lineWidth = cue.inWindow ? 6.5 : 4.2;
  ctx.beginPath();
  ctx.arc(
    state.currentNode.x,
    state.currentNode.y,
    state.orbitRadius + 8,
    cue.idealAngle - cue.windowRadians,
    cue.idealAngle + cue.windowRadians,
  );
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.setLineDash([8, 10]);
  ctx.strokeStyle = cue.inWindow ? "rgba(255,244,177,0.82)" : "rgba(238,247,255,0.2)";
  ctx.lineWidth = cue.inWindow ? 1.8 : 1.2;
  ctx.beginPath();
  ctx.moveTo(cue.idealPoint.x, cue.idealPoint.y);
  ctx.lineTo(state.targetNode.x, state.targetNode.y);
  ctx.stroke();
  ctx.setLineDash([]);

  glowCircle(cue.idealPoint.x, cue.idealPoint.y, cue.inWindow ? 7 : 4.5, "rgba(255,244,177,0.96)", cue.inWindow ? 26 : 18);
  if (state.missGhost) {
    const missProgress = state.missGhost.age / state.missGhost.life;
    ctx.strokeStyle = `rgba(255,244,177,${0.42 * (1 - missProgress)})`;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(
      state.currentNode.x,
      state.currentNode.y,
      state.orbitRadius + 13 + missProgress * 12,
      cue.idealAngle - cue.windowRadians,
      cue.idealAngle + cue.windowRadians,
    );
    ctx.stroke();
  }
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
  const swirl = performance.now() * 0.0011;
  const atmosphere = state.goldTarget ? "rgba(255,244,177,0.74)" : color.ring;
  ring(state.targetNode.x, state.targetNode.y, state.gravityRadius, "rgba(255,255,255,0.14)", 1.35);
  ring(state.targetNode.x, state.targetNode.y, state.gravityRadius * 0.72, atmosphere, 1.25);

  ctx.save();
  ctx.shadowColor = state.goldTarget ? "rgba(255,244,177,0.78)" : color.glow;
  ctx.shadowBlur = state.mode === "demo" ? 78 : 54;
  const planet = ctx.createRadialGradient(
    state.targetNode.x - state.targetRadius * 0.22,
    state.targetNode.y - state.targetRadius * 0.28,
    0,
    state.targetNode.x,
    state.targetNode.y,
    state.targetRadius * pulse,
  );
  planet.addColorStop(0, "rgba(255,255,255,0.96)");
  planet.addColorStop(0.32, state.goldTarget ? "rgba(255,244,177,0.98)" : color.core);
  planet.addColorStop(0.72, state.goldTarget ? "rgba(255,201,111,0.88)" : color.ring);
  planet.addColorStop(1, "rgba(4,8,15,0.12)");
  ctx.fillStyle = planet;
  ctx.beginPath();
  ctx.arc(state.targetNode.x, state.targetNode.y, state.targetRadius * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = state.goldTarget ? "rgba(255,255,255,0.78)" : "rgba(238,247,255,0.38)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(
    state.targetNode.x,
    state.targetNode.y,
    state.targetRadius * 0.86,
    state.targetRadius * 0.34,
    swirl,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  ring(
    state.targetNode.x,
    state.targetNode.y,
    state.targetRadius * 1.08 * pulse,
    state.targetStillDrifting ? "rgba(255,201,111,0.76)" : atmosphere,
    state.goldTarget ? 2.4 : 1.7,
  );
  ring(state.targetNode.x, state.targetNode.y, Math.max(8, state.targetRadius * 0.24), "rgba(4,8,15,0.42)", 1);
}

function drawBonusComet(state) {
  if (!state.bonusComet) return;
  const comet = state.bonusComet;
  const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.1;
  const alpha = Math.min(1, comet.remainingSeconds / 0.55);
  ctx.save();
  ctx.globalAlpha = alpha;
  ring(comet.position.x, comet.position.y, comet.radius * 1.6 * pulse, "rgba(255,244,177,0.28)", 1.2);
  glowCircle(comet.position.x, comet.position.y, comet.radius * pulse, "rgba(255,244,177,0.92)", 28);
  glowCircle(comet.position.x, comet.position.y, comet.radius * 0.38, "rgba(255,255,255,0.98)", 12);
  ctx.restore();
}

function drawTrail(state) {
  if (state.trail.length < 2) return;
  for (let i = 1; i < state.trail.length; i += 1) {
    const a = state.trail[i - 1];
    const b = state.trail[i];
    const alpha = Math.max(0, (state.launchActive ? 0.68 : 0.46) - b.age * 0.5);
    const color = state.overdriveActive ? "255,244,177" : state.launchActive ? "238,247,255" : "151,255,210";
    ctx.strokeStyle = `rgba(${color},${alpha})`;
    ctx.lineWidth = Math.max(1, (state.launchActive ? 8 : 6) * (1 - i / state.trail.length));
    ctx.lineCap = "round";
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
  const cueBoost = state.timingCue?.inWindow ? 1.24 : 1;
  const driveBoost = state.overdriveActive ? 1.22 : 1;
  const size = Math.max(6.6, 8.5 * state.width / Math.max(state.width, 900)) * cueBoost * driveBoost;
  const color = state.timingCue?.inWindow || state.overdriveActive ? "rgba(255,244,177,1)" : "rgba(238,247,255,1)";
  glowCircle(state.particle.x, state.particle.y, size, color, state.overdriveActive ? 38 : 24);
  glowCircle(state.particle.x, state.particle.y, 4.5 * cueBoost, "rgba(255,255,255,1)", 12);
}

function drawFeedback(state) {
  for (const item of state.feedback) {
    const progress = item.age / item.life;
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle =
      item.kind === "miss"
        ? "#ff9ab0"
        : item.kind === "level" || item.kind === "bullseye" || item.kind === "overdrive"
          ? "#fff4b1"
        : item.kind === "core"
          ? "#ffc96f"
          : item.kind === "bonus" || item.kind === "streak"
            ? "#ffe87e"
          : "#b9ffe1";
    const size = item.kind === "overdrive" || item.kind === "bullseye" ? 17 : item.kind === "level" ? 15 : 12;
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    const labels = {
      miss: "JUST MISSED",
      level: "PLANET IGNITED",
      bullseye: "BULLSEYE",
      core: "CORE",
      hit: "HIT",
      graze: "GRAZE",
      streak: "STREAK +100",
      bonus: "COMET +150",
      overdrive: "OVERDRIVE",
      catch: "CATCH",
    };
    const label = item.text ?? labels[item.kind] ?? "HIT";
    ctx.fillText(label, item.x, item.y - 26 - progress * 18);
    ctx.globalAlpha = 1;
  }
}

function drawMissGhost(state) {
  if (!state.missGhost) return;
  const ghost = state.missGhost;
  const progress = ghost.age / ghost.life;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress);
  ctx.strokeStyle = "rgba(255,154,176,0.38)";
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 10]);
  ctx.beginPath();
  ctx.moveTo(ghost.start.x, ghost.start.y);
  ctx.lineTo(ghost.end.x, ghost.end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawExplosion(state) {
  if (!state.explosion) return;
  const explosion = state.explosion;
  const power = explosion.power ?? 1;
  const shock = Math.min(1, explosion.age / (0.55 + power * 0.08));
  const shockRadius = 28 + shock * Math.max(120, state.gravityRadius * (1.2 + power));
  if (power >= 2.6) {
    ctx.save();
    const flashAlpha = Math.max(0, 0.2 * (1 - explosion.age / 0.18));
    ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.restore();
  }
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

function drawLevelBanner(state) {
  if (!state.levelBanner) return;
  const banner = state.levelBanner;
  const progress = banner.age / banner.life;
  const alpha = Math.sin(Math.min(1, progress) * Math.PI);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff4b1";
  ctx.font = "800 22px Inter, system-ui, sans-serif";
  ctx.shadowColor = "rgba(255,244,177,0.5)";
  ctx.shadowBlur = 20;
  ctx.fillText(banner.text, state.width / 2, state.height * 0.28);
  ctx.restore();
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

  const scoreEl = document.querySelector("#hudScore");
  if (hudState.score !== lastHudScore) {
    scoreEl.classList.remove("score-pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("score-pop");
    lastHudScore = hudState.score;
  }
  scoreEl.textContent = String(hudState.score);
  document.querySelector("#hudCombo").textContent =
    `x${hudState.comboMultiplier.toFixed(1)} · ${hudState.streak}`;
  document.querySelector("#hudShields").innerHTML = renderShieldIcons(
    hudState.mode === "demo" ? hudState.maxShields : hudState.shields,
    hudState.maxShields,
  );
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
    const cleared = hudState.endReason === "all-levels-cleared";
    const strongRun = hudState.bestStreak >= 10;
    document.querySelector("#endTitle").textContent = cleared
      ? "Galaxy Cleared"
      : hudState.endReason === "shields-depleted"
        ? "Shields Depleted"
        : strongRun
          ? "New Best Streak"
          : "Run Over";
    document.querySelector("#endScore").textContent = String(hudState.score);
    document.querySelector("#endBestCombo").textContent = `x${hudState.bestComboMultiplier.toFixed(1)} · ${hudState.bestStreak}`;
    document.querySelector("#endBullseyes").textContent = String(hudState.bullseyes);
    document.querySelector("#endAccuracy").textContent = `${hudState.accuracy}%`;
    document.querySelector("#endFurthestLevel").textContent =
      `${Math.min(hudState.furthestLevelIndex + 1, hudState.levelCount)}/${hudState.levelCount}`;
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

function renderShieldIcons(shields, maxShields) {
  const clamped = Math.max(0, Math.min(maxShields, Math.round(shields)));
  return Array.from({ length: maxShields }, (_, index) => {
    const filled = index < clamped;
    return `<span class="shield-icon${filled ? " is-filled" : ""}" aria-hidden="true"></span>`;
  }).join("");
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
  ensureAudio();
  game.startMeasured();
});
downloadButton.addEventListener("click", downloadSessionData);

updateStartNote();
resize();
requestAnimationFrame(tick);
