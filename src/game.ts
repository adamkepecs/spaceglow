import {
  clonePoint,
  distance,
  idealLaunchAngle,
  orbitPoint,
  pointWithinBounds,
  rayCircleIntersectionDistance,
  signedAngleDelta,
  sub,
  tangentDirection,
  vec,
  wrapRadians,
} from "./geometry.ts";
import { phaseForSessionTime, PHASES } from "./phases.ts";
import { SeededRandom } from "./rng.ts";
import { APP_VERSION, DEMO_RULES, LEVELS, SETTINGS, TARGET_STAGES, TAU } from "./settings.ts";
import {
  beginTrial,
  createTelemetry,
  finishTrial,
  markDriftEvent,
  recordTap,
} from "./telemetry.ts";
import { computeSummary } from "./summary.ts";
import { createDriftPlan, updateDriftPlan } from "./volatility.ts";

const LEVEL_IDS = LEVELS.map((level) => level.id);

export class SpaceGlowGame {
  constructor(options = {}) {
    const seed = options.seed ?? String(Date.now());
    this.seed = seed;
    this.rng = new SeededRandom(seed);
    this.width = options.width ?? 960;
    this.height = options.height ?? 640;
    this.debug = Boolean(options.debug);
    this.mode = "start";
    this.selectedLevelId = LEVEL_IDS.includes(options.level) ? options.level : "easy";
    this.levelCursor = LEVEL_IDS.indexOf(this.selectedLevelId);
    this.levelHits = 0;
    this.demoHits = 0;
    this.demoElapsed = 0;
    this.demoReturnToPlay = false;
    this.levelCompleteElapsed = 0;
    this.levelCompleteDuration = 2.4;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.practiceElapsed = 0;
    this.practiceHits = 0;
    this.sessionElapsed = 0;
    this.globalElapsed = 0;
    this.trialCounter = 0;
    this.tapCounter = 0;
    this.currentNode = vec(this.width * 0.42, this.height * 0.52);
    this.targetNode = vec(this.width * 0.68, this.height * 0.45);
    this.targetOriginalPosition = clonePoint(this.targetNode);
    this.particleAngle = this.rng.range(0, TAU);
    this.launch = null;
    this.trial = null;
    this.telemetry = null;
    this.summary = null;
    this.lastTapGlobalTime = null;
    this.trail = [];
    this.feedback = [];
    this.stars = [];
    this.audioEvents = [];
    this.explosion = null;
    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = Math.max(320, width);
    this.height = Math.max(420, height);
    this.scale = Math.max(0.72, Math.min(1.18, Math.min(this.width, this.height) / 720));
    this.applyRules();
    if (!this.stars.length) this.createStars();
  }

  applyRules() {
    const rules = this.currentRules();
    this.orbitRadius = rules.orbitRadius * this.scale;
    this.nodeRadius = SETTINGS.nodeRadius * this.scale;
    this.targetRadius = rules.targetRadius * this.scale;
    this.hitGraceRadius = rules.gravityRadius * this.scale;
    this.gravityRadius = rules.gravityRadius * this.scale;
    this.projectileSpeed = rules.projectileSpeed * this.scale;
    this.angularSpeed = TAU / rules.orbitPeriodSeconds;
  }

  currentLevel() {
    const index = Math.max(0, Math.min(this.levelCursor, LEVELS.length - 1));
    return LEVELS[index] ?? LEVELS[0];
  }

  currentRules() {
    if (this.mode === "demo") return DEMO_RULES;
    return this.currentLevel();
  }

  createStars() {
    this.stars = [];
    const count = Math.round(Math.max(80, Math.min(170, (this.width * this.height) / 6500)));
    for (let i = 0; i < count; i += 1) {
      this.stars.push({
        x: this.rng.range(0, this.width),
        y: this.rng.range(0, this.height),
        radius: this.rng.range(0.35, 1.35),
        alpha: this.rng.range(0.15, 0.8),
        pulse: this.rng.range(0.35, 1.8),
      });
    }
  }

  setLevel(levelId) {
    if (!LEVEL_IDS.includes(levelId)) return;
    this.selectedLevelId = levelId;
    if (this.mode === "start" || this.mode === "ended") {
      this.levelCursor = LEVEL_IDS.indexOf(levelId);
      this.applyRules();
    }
  }

  startPractice() {
    this.startDemo(true);
  }

  startDemo(returnToPlay = false) {
    this.mode = "demo";
    this.demoReturnToPlay = returnToPlay;
    this.demoHits = 0;
    this.demoElapsed = 0;
    this.practiceElapsed = 0;
    this.practiceHits = 0;
    this.launch = null;
    this.trial = null;
    this.trail = [];
    this.feedback = [];
    this.explosion = null;
    this.lastTapGlobalTime = null;
    this.endReason = null;
    this.currentNode = vec(this.width * 0.38, this.height * 0.46);
    this.particleAngle = this.rng.range(0, TAU);
    this.applyRules();
    this.startNewTrial();
    this.queueAudio("demoStart");
  }

  startMeasured() {
    this.mode = "running";
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.sessionElapsed = 0;
    this.summary = null;
    this.endReason = null;
    this.levelCursor = LEVEL_IDS.indexOf(this.selectedLevelId);
    if (this.levelCursor < 0) this.levelCursor = 0;
    this.levelHits = 0;
    this.launch = null;
    this.trail = [];
    this.feedback = [];
    this.explosion = null;
    this.lastTapGlobalTime = null;
    this.currentNode = vec(this.width * 0.38, this.height * 0.48);
    this.particleAngle = this.rng.range(0, TAU);
    this.applyRules();
    this.telemetry = createTelemetry({
      sessionId: makeSessionId(this.seed),
      seed: this.seed,
      width: Math.round(this.width),
      height: Math.round(this.height),
      timestamp: new Date().toISOString(),
    });
    this.startNewTrial();
    this.queueAudio("start");
  }

  restart() {
    this.rng = new SeededRandom(this.seed);
    this.mode = "start";
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.practiceElapsed = 0;
    this.practiceHits = 0;
    this.demoHits = 0;
    this.demoElapsed = 0;
    this.sessionElapsed = 0;
    this.globalElapsed = 0;
    this.trialCounter = 0;
    this.tapCounter = 0;
    this.levelCursor = LEVEL_IDS.indexOf(this.selectedLevelId);
    this.levelHits = 0;
    this.launch = null;
    this.trial = null;
    this.telemetry = null;
    this.summary = null;
    this.lastTapGlobalTime = null;
    this.trail = [];
    this.feedback = [];
    this.explosion = null;
    this.stars = [];
    this.applyRules();
    this.createStars();
  }

  update(dt) {
    const step = Math.max(0, Math.min(dt, 0.05));
    this.globalElapsed += step;
    this.feedback = this.feedback
      .map((item) => ({ ...item, age: item.age + step }))
      .filter((item) => item.age < item.life);
    this.updateExplosion(step);

    if (this.mode === "levelComplete") {
      this.sessionElapsed = Math.min(SETTINGS.sessionSeconds, this.sessionElapsed + step);
      if (this.sessionElapsed >= SETTINGS.sessionSeconds) {
        this.endSession("time-complete");
        return;
      }
      this.levelCompleteElapsed += step;
      if (this.levelCompleteElapsed >= this.levelCompleteDuration) this.startNextLevel();
      return;
    }

    if (this.mode === "demo") this.demoElapsed += step;

    if (this.mode === "running") {
      this.sessionElapsed = Math.min(SETTINGS.sessionSeconds, this.sessionElapsed + step);
      if (this.sessionElapsed >= SETTINGS.sessionSeconds) {
        this.endSession("time-complete");
        return;
      }
    }

    if (this.mode !== "demo" && this.mode !== "running") return;

    if (this.launch) {
      this.updateLaunch(step);
    } else {
      this.particleAngle = wrapRadians(this.particleAngle + this.angularSpeed * step);
      this.updateTargetDrift();
      this.pushTrail(this.currentParticlePosition());
    }
  }

  tap(inputKind = "tap") {
    if (this.mode !== "demo" && this.mode !== "running") return;

    const rapid =
      this.lastTapGlobalTime !== null &&
      this.globalElapsed - this.lastTapGlobalTime < SETTINGS.rapidTapWindowSeconds;
    this.lastTapGlobalTime = this.globalElapsed;

    if (this.launch) {
      this.logTap(inputKind, {
        rapid,
        rapidTap: rapid,
        extraRapidTap: true,
        wouldHitTarget: false,
        launchSucceeded: false,
      });
      this.queueAudio("rapid");
      return;
    }

    this.updateTargetDrift();
    const origin = this.currentParticlePosition();
    const direction = tangentDirection(this.particleAngle);
    const hitDistance = rayCircleIntersectionDistance(
      origin,
      direction,
      this.targetNode,
      this.gravityRadius,
    );
    const willHit = hitDistance !== null;

    this.logTap(inputKind, {
      rapid,
      rapidTap: rapid,
      extraRapidTap: false,
      wouldHitTarget: willHit,
      launchSucceeded: willHit,
    });

    this.launch = {
      origin,
      direction,
      elapsed: 0,
      duration: willHit
        ? Math.max(0.12, hitDistance / this.projectileSpeed + SETTINGS.hitSettleSeconds)
        : SETTINGS.missResetSeconds,
      hitDistance: hitDistance ?? this.projectileSpeed * SETTINGS.missResetSeconds,
      willHit,
      particlePosition: clonePoint(origin),
      frozenTarget: clonePoint(this.targetNode),
      trialId: this.trial?.id ?? null,
    };
    this.queueAudio("launch");
  }

  logTap(inputKind, overrides) {
    if (this.mode !== "running" || !this.telemetry || !this.trial) return;

    const phase = phaseForSessionTime(this.sessionElapsed);
    const ideal = idealLaunchAngle(this.currentNode, this.targetNode, this.orbitRadius);
    const signedDelta = signedAngleDelta(this.particleAngle, ideal);
    const timingDifference = signedDelta / this.angularSpeed;
    const nextIdeal =
      signedDelta <= 0
        ? -signedDelta / this.angularSpeed
        : (TAU - signedDelta) / this.angularSpeed;
    const waitTime = this.sessionElapsed - this.trial.startTime;
    const direction =
      Math.abs(timingDifference) < 0.035 ? "on-time" : timingDifference < 0 ? "early" : "late";

    recordTap(this.telemetry, {
      id: `tap-${++this.tapCounter}`,
      sessionTime: this.sessionElapsed,
      phase: phase.id,
      trialId: this.trial.id,
      inputKind,
      currentNodePosition: this.currentNode,
      targetNodePosition: this.targetNode,
      particleAngleRadians: this.particleAngle,
      idealLaunchAngleRadians: ideal,
      idealLaunchTimingSeconds: nextIdeal,
      timingDifferenceSeconds: timingDifference,
      timingDirection: direction,
      wouldHitTarget: overrides.wouldHitTarget,
      waitTimeBeforeTapSeconds: waitTime,
      rotationsWaited: waitTime / this.currentRules().orbitPeriodSeconds,
      targetHadDrifted: Boolean(this.trial.driftPlan?.occurred),
      targetStillDrifting: Boolean(this.trial.targetStillDrifting),
      launchSucceeded: overrides.launchSucceeded,
      rapidTap: overrides.rapidTap,
      extraRapidTap: overrides.extraRapidTap,
    });
  }

  updateLaunch(dt) {
    this.launch.elapsed += dt;
    const progress = Math.min(1, this.launch.elapsed / this.launch.duration);
    const maxDistance = this.launch.willHit
      ? this.launch.hitDistance
      : this.projectileSpeed * this.launch.duration;
    this.launch.particlePosition = {
      x: this.launch.origin.x + this.launch.direction.x * maxDistance * progress,
      y: this.launch.origin.y + this.launch.direction.y * maxDistance * progress,
    };
    this.pushTrail(this.launch.particlePosition);

    if (progress < 1) return;

    const trialId = this.launch.trialId;
    if (this.launch.willHit) {
      const caughtPoint = clonePoint(this.launch.frozenTarget);
      this.currentNode = caughtPoint;
      this.particleAngle = this.angleFromNode(this.launch.particlePosition, this.currentNode);

      if (this.mode === "demo") {
        this.demoHits += 1;
        this.practiceHits = this.demoHits;
        this.score += 5;
        this.streak += 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        this.addFeedback("catch", this.currentNode);
        this.queueAudio("hit");
        this.launch = null;
        if (this.demoHits >= DEMO_RULES.successesToComplete) {
          this.queueAudio("demoComplete");
          if (this.demoReturnToPlay) this.startMeasured();
          else this.mode = "start";
        } else {
          this.startNewTrial();
        }
        return;
      }

      const level = this.currentLevel();
      this.score += SETTINGS.scoring.hit + this.streak * 2;
      if ((this.streak + 1) % SETTINGS.scoring.streakBonusEvery === 0) this.score += 25;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.levelHits += 1;
      if (this.telemetry) finishTrial(this.telemetry, trialId, "hit", this.sessionElapsed, caughtPoint);
      this.addFeedback(this.levelHits >= level.successesToComplete ? "level" : "catch", caughtPoint);
      this.queueAudio("hit");
      this.launch = null;

      if (this.levelHits >= level.successesToComplete) {
        this.completeLevel(caughtPoint);
      } else {
        this.startNewTrial();
      }
      return;
    }

    this.streak = 0;
    if (this.mode === "running" && this.telemetry) {
      finishTrial(this.telemetry, trialId, "miss", this.sessionElapsed, this.targetNode);
    }
    this.addFeedback("miss", this.targetNode);
    this.queueAudio("miss");
    this.launch = null;
    this.startNewTrial();
  }

  completeLevel(point) {
    const level = this.currentLevel();
    this.score += level.completionBonus;
    this.mode = "levelComplete";
    this.levelCompleteElapsed = 0;
    this.explosion = createExplosion(this.rng, point, this.getTargetColor());
    this.queueAudio("levelComplete");
    this.queueAudio("vibrateStrong");
  }

  startNextLevel() {
    this.levelCursor += 1;
    if (this.levelCursor >= LEVELS.length) {
      this.endSession("all-levels-cleared");
      return;
    }
    this.mode = "running";
    this.levelHits = 0;
    this.launch = null;
    this.trail = [];
    this.feedback = [];
    this.explosion = null;
    this.currentNode = vec(this.width * 0.38, this.height * 0.48);
    this.particleAngle = this.rng.range(0, TAU);
    this.applyRules();
    this.startNewTrial();
    this.queueAudio("nextLevel");
  }

  startNewTrial() {
    this.applyRules();
    const phase = this.mode === "running" ? phaseForSessionTime(this.sessionElapsed) : PHASES.practice;
    const target = this.generateTarget();
    this.targetNode = clonePoint(target);
    this.targetOriginalPosition = clonePoint(target);
    const volatilityActive = this.mode === "running" && phase.id === "drift";
    const driftPlan = volatilityActive
      ? createDriftPlan(
          this.rng,
          this.currentNode,
          target,
          this.width,
          this.height,
          this.orbitRadius,
          this.targetRadius,
        )
      : null;

    this.trial = {
      id: `trial-${++this.trialCounter}`,
      startTime: this.mode === "running" ? this.sessionElapsed : this.demoElapsed,
      phase: this.mode === "running" ? phase.id : "demo",
      currentNode: clonePoint(this.currentNode),
      targetNode: clonePoint(target),
      targetOriginalPosition: clonePoint(target),
      targetFinalPosition: driftPlan?.to ? clonePoint(driftPlan.to) : clonePoint(target),
      volatilityActive,
      driftPlan,
      targetStillDrifting: false,
    };

    if (this.mode === "running" && this.telemetry) beginTrial(this.telemetry, this.trial);
  }

  updateTargetDrift() {
    if (!this.trial?.driftPlan || this.mode !== "running") return;
    if (this.sessionElapsed >= SETTINGS.phaseSeconds.drift) {
      this.trial.targetStillDrifting = false;
      return;
    }
    const elapsed = this.sessionElapsed - this.trial.startTime;
    const driftState = updateDriftPlan(this.trial.driftPlan, elapsed);
    this.targetNode = driftState.position;
    this.trial.targetStillDrifting = driftState.stillDrifting;
    if (driftState.occurred && this.telemetry) {
      markDriftEvent(this.telemetry, this.trial, driftState, this.sessionElapsed);
    }
  }

  generateTarget() {
    const rules = this.currentRules();
    const margin = Math.max(78, this.orbitRadius + this.gravityRadius + 12);
    const minDistance = Math.min(rules.minTargetDistance * this.scale, Math.min(this.width, this.height) * 0.36);
    const maxDistance = Math.min(rules.maxTargetDistance * this.scale, Math.min(this.width, this.height) * 0.5);

    for (let attempt = 0; attempt < 90; attempt += 1) {
      const preferredAngle = this.mode === "demo" && attempt < 12 ? this.rng.range(-0.45, 0.45) : this.rng.range(0, TAU);
      const angle = preferredAngle + (this.currentNode.x > this.width * 0.5 ? Math.PI : 0);
      const d = this.rng.range(minDistance, Math.max(minDistance + 24, maxDistance));
      const candidate = {
        x: this.currentNode.x + Math.cos(angle) * d,
        y: this.currentNode.y + Math.sin(angle) * d,
      };
      if (
        pointWithinBounds(candidate, this.width, this.height, margin) &&
        distance(candidate, this.currentNode) > this.orbitRadius + this.gravityRadius + 52
      ) {
        return candidate;
      }
    }

    return {
      x: this.width * (this.currentNode.x < this.width * 0.5 ? 0.72 : 0.28),
      y: this.height * this.rng.range(0.32, 0.58),
    };
  }

  currentParticlePosition() {
    if (this.launch) return clonePoint(this.launch.particlePosition);
    return orbitPoint(this.currentNode, this.orbitRadius, this.particleAngle);
  }

  angleFromNode(point, node) {
    const delta = sub(point, node);
    const raw = Math.atan2(delta.y, delta.x);
    if (!Number.isFinite(raw)) return this.particleAngle;
    return wrapRadians(raw);
  }

  pushTrail(point) {
    this.trail.push({ x: point.x, y: point.y, age: 0 });
    this.trail = this.trail
      .map((item) => ({ ...item, age: item.age + 0.016 }))
      .filter((item) => item.age < 0.9)
      .slice(-52);
  }

  addFeedback(kind, point) {
    this.feedback.push({
      kind,
      x: point.x,
      y: point.y,
      age: 0,
      life: kind === "level" ? 1.2 : kind === "miss" ? 0.55 : 0.42,
    });
  }

  updateExplosion(dt) {
    if (!this.explosion) return;
    this.explosion.age += dt;
    this.explosion.particles = this.explosion.particles.map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * dt,
      y: particle.y + particle.vy * dt,
      vy: particle.vy + 18 * dt,
      age: particle.age + dt,
    }));
  }

  queueAudio(kind) {
    this.audioEvents.push(kind);
  }

  consumeAudioEvents() {
    const events = [...this.audioEvents];
    this.audioEvents.length = 0;
    return events;
  }

  endSession(reason = "complete") {
    if (this.mode === "ended") return;
    this.mode = "ended";
    this.endReason = reason;
    if (this.telemetry) {
      this.summary = computeSummary(this.telemetry);
      this.telemetry.summary = this.summary;
      this.telemetry.endReason = reason;
      this.telemetry.finalLevel = this.currentLevel().id;
      this.telemetry.finalScore = this.score;
    }
    this.queueAudio("end");
  }

  toggleDebug() {
    this.debug = !this.debug;
  }

  getTargetStage() {
    if (this.mode === "demo") {
      const demoProgress = this.demoHits / Math.max(1, DEMO_RULES.successesToComplete - 1);
      return Math.min(
        TARGET_STAGES.length - 1,
        Math.floor(demoProgress * (TARGET_STAGES.length - 1)),
      );
    }
    const level = this.currentLevel();
    if (!level || level.successesToComplete <= 1) return TARGET_STAGES.length - 1;
    return Math.min(
      TARGET_STAGES.length - 1,
      Math.floor((this.levelHits / (level.successesToComplete - 1)) * (TARGET_STAGES.length - 1)),
    );
  }

  getTargetColor() {
    return TARGET_STAGES[this.getTargetStage()] ?? TARGET_STAGES[0];
  }

  getTimingCue(ideal) {
    const idealPoint = orbitPoint(this.currentNode, this.orbitRadius, ideal);
    const direction = tangentDirection(ideal);
    const delta = signedAngleDelta(this.particleAngle, ideal);
    const timingDifference = delta / this.angularSpeed;
    const windowSeconds = this.mode === "demo" ? 0.18 : 0.11;
    return {
      idealAngle: ideal,
      idealPoint,
      tangentEnd: {
        x: idealPoint.x + direction.x * distance(idealPoint, this.targetNode),
        y: idealPoint.y + direction.y * distance(idealPoint, this.targetNode),
      },
      timingDifferenceSeconds: timingDifference,
      windowSeconds,
      windowRadians: windowSeconds * this.angularSpeed,
      inWindow: Math.abs(timingDifference) <= windowSeconds,
      intensity: Math.max(0, 1 - Math.abs(timingDifference) / (windowSeconds * 3.2)),
    };
  }

  getRenderState() {
    const phase =
      this.mode === "running"
        ? phaseForSessionTime(this.sessionElapsed)
        : this.mode === "demo"
          ? { ...PHASES.practice, id: "demo", label: "Demo" }
          : null;
    const particle = this.currentParticlePosition();
    const ideal = idealLaunchAngle(this.currentNode, this.targetNode, this.orbitRadius);
    const timingCue = this.getTimingCue(ideal);
    const level = this.currentLevel();

    return {
      appVersion: APP_VERSION,
      mode: this.mode,
      width: this.width,
      height: this.height,
      currentNode: clonePoint(this.currentNode),
      targetNode: clonePoint(this.targetNode),
      targetOriginalPosition: clonePoint(this.targetOriginalPosition),
      targetFinalPosition: this.trial?.targetFinalPosition
        ? clonePoint(this.trial.targetFinalPosition)
        : clonePoint(this.targetNode),
      particle,
      particleAngle: this.particleAngle,
      orbitRadius: this.orbitRadius,
      targetRadius: this.targetRadius,
      gravityRadius: this.gravityRadius,
      nodeRadius: this.nodeRadius,
      trail: this.trail.map((item) => ({ x: item.x, y: item.y, age: item.age })),
      stars: this.stars,
      launchActive: Boolean(this.launch),
      driftActive: Boolean(this.trial?.driftPlan?.occurred),
      targetStillDrifting: Boolean(this.trial?.targetStillDrifting),
      phase,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      selectedLevelId: this.selectedLevelId,
      levelId: level.id,
      levelLabel: level.label,
      levelIndex: this.levelCursor,
      levelCount: LEVELS.length,
      levelHits: this.levelHits,
      levelTargetHits: level.successesToComplete,
      demoHits: this.demoHits,
      demoTargetHits: DEMO_RULES.successesToComplete,
      targetStage: this.getTargetStage(),
      targetColor: this.getTargetColor(),
      timingCue,
      showTimingCues: this.mode === "demo" || this.mode === "running",
      practiceHits: this.demoHits,
      practiceTargetHits: DEMO_RULES.successesToComplete,
      practiceElapsed: this.demoElapsed,
      sessionElapsed: this.sessionElapsed,
      sessionRemaining: Math.max(0, SETTINGS.sessionSeconds - this.sessionElapsed),
      feedback: this.feedback,
      explosion: this.explosion,
      endReason: this.endReason,
      debug: {
        enabled: this.debug,
        idealLaunchAngle: ideal,
        timingDifferenceSeconds: timingCue.timingDifferenceSeconds,
        trialId: this.trial?.id ?? null,
        trialPhase: this.trial?.phase ?? null,
        driftScheduled: Boolean(this.trial?.driftPlan?.scheduled),
        targetStillDrifting: Boolean(this.trial?.targetStillDrifting),
      },
    };
  }

  getHudState() {
    const finishedTrials = this.telemetry
      ? this.telemetry.trials.filter((trial) => trial.outcome === "hit" || trial.outcome === "miss")
      : [];
    const totalAttempts = finishedTrials.length || this.demoHits;
    const hits = finishedTrials.filter((trial) => trial.outcome === "hit").length || this.demoHits;
    const accuracy = totalAttempts ? Math.round((hits / totalAttempts) * 100) : 0;
    const level = this.currentLevel();
    return {
      mode: this.mode,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      accuracy,
      selectedLevelId: this.selectedLevelId,
      levelId: level.id,
      levelLabel: level.label,
      levelIndex: this.levelCursor,
      levelCount: LEVELS.length,
      levelHits: this.levelHits,
      levelTargetHits: level.successesToComplete,
      demoHits: this.demoHits,
      demoTargetHits: DEMO_RULES.successesToComplete,
      sessionRemaining: Math.max(0, SETTINGS.sessionSeconds - this.sessionElapsed),
      practiceHits: this.demoHits,
      practiceTargetHits: DEMO_RULES.successesToComplete,
      summary: this.summary,
      endReason: this.endReason,
    };
  }

  getSessionData() {
    if (!this.telemetry) return null;
    return this.telemetry;
  }
}

function createExplosion(rng, point, color) {
  const particles = [];
  for (let i = 0; i < 42; i += 1) {
    const angle = rng.range(0, TAU);
    const speed = rng.range(80, 330);
    particles.push({
      x: point.x,
      y: point.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: rng.range(2, 8),
      age: 0,
      life: rng.range(0.65, 1.4),
      color: i % 3 === 0 ? "rgba(255,255,255,0.95)" : color.core,
    });
  }
  return { x: point.x, y: point.y, age: 0, color, particles };
}

function makeSessionId(seed) {
  const random = Math.random().toString(36).slice(2, 8);
  return `space-glow-${Date.now().toString(36)}-${String(seed).slice(0, 8)}-${random}`;
}
