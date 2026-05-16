import {
  add,
  clamp,
  clonePoint,
  closestDistanceFromRayToPoint,
  distance,
  idealLaunchAngle,
  orbitPoint,
  pointWithinBounds,
  rayCircleIntersectionDistance,
  scale,
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
    this.bestBoom = 0;
    this.maxShields = SETTINGS.shields.max;
    this.shields = 0;
    this.shieldsDepletedPending = false;
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
    this.lastMoment = null;
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

  getStartingShieldsForLevel(levelId) {
    return SETTINGS.shields.startByLevel[levelId] ?? SETTINGS.shields.startByLevel.easy;
  }

  changeShields(delta) {
    const previous = this.shields;
    this.shields = clamp(this.shields + delta, 0, this.maxShields);
    return this.shields - previous;
  }

  loseShield(reason) {
    if (this.mode !== "running") return 0;
    const cost = reason === "rapid-tap" ? SETTINGS.shields.rapidTapCost : SETTINGS.shields.missCost;
    const delta = this.changeShields(-cost);
    if (delta < 0) this.setMoment("SHIELD LOST", 0, "miss", 0.9);
    if (this.shields <= 0) this.shieldsDepletedPending = true;
    return delta;
  }

  gainShield(amount, reason) {
    if (this.mode !== "running") return 0;
    const delta = this.changeShields(amount);
    if (delta > 0 && reason === "level-clear") {
      this.setMoment(`LEVEL CLEAR +${this.currentLevel().completionBonus}`, this.currentLevel().completionBonus, "level", 1.25);
    }
    return delta;
  }

  finishShieldCheck() {
    if (this.mode === "running" && this.shieldsDepletedPending && this.shields <= 0) {
      this.shieldsDepletedPending = false;
      this.endSession("shields-depleted");
      return true;
    }
    return false;
  }

  comboMultiplierForStreak(streak) {
    return Math.min(
      SETTINGS.scoring.maxStreakMultiplier,
      1 + Math.max(0, streak - 1) * SETTINGS.scoring.streakMultiplierStep,
    );
  }

  scoreForHit(quality, closeness, nextStreak) {
    const centerBonus = Math.round(SETTINGS.scoring.centerBonusMax * closeness * closeness);
    const qualityBonus =
      quality === "bullseye"
        ? SETTINGS.scoring.bullseyeBonus
        : quality === "core"
          ? SETTINGS.scoring.coreBonus
          : quality === "solid"
            ? SETTINGS.scoring.solidBonus
            : 0;
    const streakMultiplier = this.comboMultiplierForStreak(nextStreak);
    let points = Math.round(
      (SETTINGS.scoring.baseHit + centerBonus + qualityBonus) * streakMultiplier,
    );
    if (nextStreak % SETTINGS.scoring.streakBonusEvery === 0) {
      points += SETTINGS.scoring.streakBonus;
    }
    return { points, centerBonus, qualityBonus, streakMultiplier };
  }

  setMoment(text, points = 0, quality = "solid", life = 1.1) {
    this.lastMoment = { text, points, quality, age: 0, life };
  }

  startPractice() {
    this.startDemo(true);
  }

  startDemo(returnToPlay = false) {
    this.mode = "demo";
    this.demoReturnToPlay = returnToPlay;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.demoHits = 0;
    this.demoElapsed = 0;
    this.practiceElapsed = 0;
    this.practiceHits = 0;
    this.bestBoom = 0;
    this.maxShields = SETTINGS.shields.max;
    this.shields = this.maxShields;
    this.shieldsDepletedPending = false;
    this.launch = null;
    this.trial = null;
    this.trail = [];
    this.feedback = [];
    this.explosion = null;
    this.lastMoment = null;
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
    this.bestBoom = 0;
    this.sessionElapsed = 0;
    this.summary = null;
    this.endReason = null;
    this.levelCursor = LEVEL_IDS.indexOf(this.selectedLevelId);
    if (this.levelCursor < 0) this.levelCursor = 0;
    this.levelHits = 0;
    this.maxShields = SETTINGS.shields.max;
    this.shields = this.getStartingShieldsForLevel(this.currentLevel().id);
    this.shieldsDepletedPending = false;
    this.launch = null;
    this.trail = [];
    this.feedback = [];
    this.explosion = null;
    this.lastMoment = null;
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
    this.bestBoom = 0;
    this.maxShields = SETTINGS.shields.max;
    this.shields = 0;
    this.shieldsDepletedPending = false;
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
    this.lastMoment = null;
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
    if (this.lastMoment) {
      this.lastMoment = { ...this.lastMoment, age: this.lastMoment.age + step };
      if (this.lastMoment.age >= this.lastMoment.life) this.lastMoment = null;
    }
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
      if (this.trial?.targetMotionPlan) this.updateTargetMotion();
      else this.updateTargetDrift();
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
      let shieldDelta = 0;
      if (
        rapid &&
        this.mode === "running" &&
        this.shields > 1 &&
        !this.launch.rapidPenaltyApplied
      ) {
        shieldDelta = this.loseShield("rapid-tap");
        this.launch.rapidPenaltyApplied = true;
      }
      this.logTap(inputKind, {
        rapid,
        rapidTap: rapid,
        extraRapidTap: true,
        wouldHitTarget: false,
        launchSucceeded: false,
        centerDistance: null,
        centerCloseness: 0,
        hitQuality: "extra",
        pointsAwarded: 0,
        shieldDelta,
        shieldsAfter: this.shields,
      });
      this.queueAudio("rapid");
      if (this.finishShieldCheck()) this.launch = null;
      return;
    }

    if (this.trial?.targetMotionPlan) this.updateTargetMotion();
    else this.updateTargetDrift();
    const origin = this.currentParticlePosition();
    const direction = tangentDirection(this.particleAngle);
    const hitDistance = rayCircleIntersectionDistance(
      origin,
      direction,
      this.targetNode,
      this.gravityRadius,
    );
    const willHit = hitDistance !== null;
    const centerDistance = closestDistanceFromRayToPoint(origin, direction, this.targetNode);
    const centerCloseness = willHit ? clamp(1 - centerDistance / this.gravityRadius, 0, 1) : 0;
    const hitQuality = willHit ? hitQualityForCloseness(centerCloseness) : "miss";
    const scorePreview =
      willHit && this.mode === "running"
        ? this.scoreForHit(hitQuality, centerCloseness, this.streak + 1).points
        : 0;

    this.logTap(inputKind, {
      rapid,
      rapidTap: rapid,
      extraRapidTap: false,
      wouldHitTarget: willHit,
      launchSucceeded: willHit,
      centerDistance,
      centerCloseness,
      hitQuality,
      pointsAwarded: scorePreview,
      shieldDelta: 0,
      shieldsAfter: this.shields,
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
      centerDistance,
      centerCloseness,
      hitQuality,
      particlePosition: clonePoint(origin),
      frozenTarget: clonePoint(this.targetNode),
      trialId: this.trial?.id ?? null,
      rapidPenaltyApplied: false,
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
      centerDistance: overrides.centerDistance,
      centerCloseness: overrides.centerCloseness,
      hitQuality: overrides.hitQuality,
      pointsAwarded: overrides.pointsAwarded,
      shieldDelta: overrides.shieldDelta,
      shieldsAfter: overrides.shieldsAfter,
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
      const launch = this.launch;
      const caughtPoint = clonePoint(this.launch.frozenTarget);
      this.currentNode = caughtPoint;
      this.particleAngle = this.angleFromNode(this.launch.particlePosition, this.currentNode);
      const quality = launch.hitQuality;
      const qualityLabel = hitQualityLabel(quality);
      const hitPower = clamp(
        0.45 + launch.centerCloseness * 1.8 + Math.min(this.streak, 20) * 0.025,
        0.5,
        2.6,
      );

      if (this.mode === "demo") {
        this.demoHits += 1;
        this.practiceHits = this.demoHits;
        this.score += 5;
        this.streak += 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        this.bestBoom = Math.max(this.bestBoom, 5);
        this.addFeedback(quality, this.currentNode);
        this.explosion = createExplosion(this.rng, caughtPoint, this.getTargetColor(), hitPower);
        this.setMoment(`${qualityLabel} +5`, 5, quality);
        this.queueAudio(audioForHitQuality(quality));
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
      const nextStreak = this.streak + 1;
      const hitScore = this.scoreForHit(quality, launch.centerCloseness, nextStreak);
      this.score += hitScore.points;
      this.streak = nextStreak;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.bestBoom = Math.max(this.bestBoom, hitScore.points);
      this.levelHits += 1;
      const shieldGain =
        quality === "bullseye"
          ? SETTINGS.shields.bullseyeHitGain
          : quality === "core"
            ? SETTINGS.shields.coreHitGain
            : SETTINGS.shields.normalHitGain;
      const shieldDelta = this.gainShield(
        shieldGain,
        quality === "bullseye" ? "bullseye" : quality === "core" ? "core-hit" : "hit",
      );
      const levelComplete = this.levelHits >= level.successesToComplete;
      const explosionPower = levelComplete
        ? clamp(1.8 + launch.centerCloseness * 2.2, 2.0, 4.0)
        : hitPower;
      this.explosion = createExplosion(this.rng, caughtPoint, this.getTargetColor(), explosionPower);
      if (this.telemetry) {
        finishTrial(this.telemetry, trialId, "hit", this.sessionElapsed, caughtPoint, {
          hitQuality: quality,
          centerDistance: launch.centerDistance,
          centerCloseness: launch.centerCloseness,
          pointsAwarded: hitScore.points,
          shieldDelta,
          shieldsAfter: this.shields,
          targetMotionActive: Boolean(this.trial?.targetMotionPlan),
        });
      }
      this.addFeedback(levelComplete ? "level" : quality, caughtPoint);
      this.setMoment(`${qualityLabel} +${hitScore.points}`, hitScore.points, quality);
      this.queueAudio(audioForHitQuality(quality));
      if (quality === "bullseye" || quality === "core") this.queueAudio("vibrateSoft");
      this.launch = null;

      if (levelComplete) {
        this.completeLevel(caughtPoint, explosionPower);
      } else {
        this.startNewTrial();
      }
      return;
    }

    this.streak = 0;
    let shieldDelta = 0;
    if (this.mode === "running") shieldDelta = this.loseShield("miss");
    if (this.mode === "running" && this.telemetry) {
      finishTrial(this.telemetry, trialId, "miss", this.sessionElapsed, this.launch.frozenTarget, {
        hitQuality: "miss",
        centerDistance: this.launch.centerDistance,
        centerCloseness: 0,
        pointsAwarded: 0,
        shieldDelta,
        shieldsAfter: this.shields,
        targetMotionActive: Boolean(this.trial?.targetMotionPlan),
      });
    }
    this.addFeedback("miss", this.launch.frozenTarget);
    this.queueAudio("miss");
    this.launch = null;
    if (this.finishShieldCheck()) return;
    this.startNewTrial();
  }

  completeLevel(point, power = 3) {
    const level = this.currentLevel();
    this.score += level.completionBonus;
    this.bestBoom = Math.max(this.bestBoom, level.completionBonus);
    this.gainShield(SETTINGS.shields.levelClearGain, "level-clear");
    this.mode = "levelComplete";
    this.levelCompleteElapsed = 0;
    this.explosion = createExplosion(this.rng, point, this.getTargetColor(), power);
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
    const targetMotionPlan = this.createTargetMotionPlan(target);
    const volatilityActive =
      this.mode === "running" && phase.id === "drift" && !targetMotionPlan;
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
      targetMotionPlan,
      targetMotionActive: Boolean(targetMotionPlan),
      targetMotionPathStart: targetMotionPlan?.pathStart ? clonePoint(targetMotionPlan.pathStart) : null,
      targetMotionPathEnd: targetMotionPlan?.pathEnd ? clonePoint(targetMotionPlan.pathEnd) : null,
      targetStillDrifting: false,
    };

    if (this.mode === "running" && this.telemetry) beginTrial(this.telemetry, this.trial);
  }

  createTargetMotionPlan(target) {
    const motionRules = this.currentRules().targetMotion;
    if (this.mode !== "running" || !motionRules?.enabled || !this.rng.chance(motionRules.chance)) {
      return null;
    }

    const angle = this.rng.range(0, TAU);
    const axis = { x: Math.cos(angle), y: Math.sin(angle) };
    const margin = Math.max(78, this.orbitRadius + this.gravityRadius + 12);
    let amplitude = motionRules.amplitude * this.scale;

    while (amplitude > 4) {
      const pathStart = add(target, scale(axis, -amplitude));
      const pathEnd = add(target, scale(axis, amplitude));
      const reachable =
        distance(this.currentNode, pathStart) > this.orbitRadius + this.gravityRadius + 52 &&
        distance(this.currentNode, pathEnd) > this.orbitRadius + this.gravityRadius + 52;
      if (
        reachable &&
        pointWithinBounds(pathStart, this.width, this.height, margin) &&
        pointWithinBounds(pathEnd, this.width, this.height, margin)
      ) {
        return {
          enabled: true,
          origin: clonePoint(target),
          axis,
          amplitude,
          periodSeconds: this.rng.range(
            motionRules.periodSecondsMin,
            motionRules.periodSecondsMax,
          ),
          phaseOffset: this.rng.range(0, TAU),
          pathStart,
          pathEnd,
        };
      }
      amplitude *= 0.72;
    }

    return null;
  }

  updateTargetMotion() {
    const plan = this.trial?.targetMotionPlan;
    if (!plan || this.mode !== "running") return;
    const elapsed = this.sessionElapsed - this.trial.startTime;
    const phase = (elapsed / plan.periodSeconds) * TAU + plan.phaseOffset;
    const offset = Math.sin(phase) * plan.amplitude;
    this.targetNode = add(plan.origin, scale(plan.axis, offset));
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
      this.telemetry.finalShields = this.shields;
      this.telemetry.bestBoom = this.bestBoom;
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
      targetMotionActive: Boolean(this.trial?.targetMotionPlan),
      targetMotionPathStart: this.trial?.targetMotionPathStart
        ? clonePoint(this.trial.targetMotionPathStart)
        : null,
      targetMotionPathEnd: this.trial?.targetMotionPathEnd
        ? clonePoint(this.trial.targetMotionPathEnd)
        : null,
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
      bestBoom: this.bestBoom,
      comboMultiplier: this.comboMultiplierForStreak(Math.max(1, this.streak)),
      shields: this.shields,
      maxShields: this.maxShields,
      shieldPercent: this.maxShields ? this.shields / this.maxShields : 0,
      lastMoment: this.lastMoment ? { ...this.lastMoment } : null,
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
        targetMotionActive: Boolean(this.trial?.targetMotionPlan),
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
      bestBoom: this.bestBoom,
      comboMultiplier: this.comboMultiplierForStreak(Math.max(1, this.streak)),
      shields: this.shields,
      maxShields: this.maxShields,
      shieldPercent: this.maxShields ? this.shields / this.maxShields : 0,
      lastMoment: this.lastMoment ? { ...this.lastMoment } : null,
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

const HIT_QUALITY_LABELS = {
  bullseye: "BULLSEYE",
  core: "CORE BOOM",
  solid: "BOOM",
  graze: "GRAZE",
};

function hitQualityForCloseness(centerCloseness) {
  if (centerCloseness >= 0.9) return "bullseye";
  if (centerCloseness >= 0.68) return "core";
  if (centerCloseness >= 0.38) return "solid";
  return "graze";
}

function hitQualityLabel(quality) {
  return HIT_QUALITY_LABELS[quality] ?? "BOOM";
}

function audioForHitQuality(quality) {
  if (quality === "bullseye") return "hitBullseye";
  if (quality === "core") return "hitCore";
  if (quality === "solid") return "hitSolid";
  return "hitGraze";
}

function createExplosion(rng, point, color, power = 1) {
  const particles = [];
  const count = Math.round(22 + 48 * power);
  for (let i = 0; i < count; i += 1) {
    const angle = rng.range(0, TAU);
    const speed = rng.range(80, 260 + 160 * power);
    particles.push({
      x: point.x,
      y: point.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: rng.range(1.8, 5.5 + 4 * power),
      age: 0,
      life: rng.range(0.45, 0.9 + 0.45 * power),
      color: i % 3 === 0 ? "rgba(255,255,255,0.95)" : color.core,
    });
  }
  return { x: point.x, y: point.y, age: 0, color, power, particles };
}

function makeSessionId(seed) {
  const random = Math.random().toString(36).slice(2, 8);
  return `space-glow-${Date.now().toString(36)}-${String(seed).slice(0, 8)}-${random}`;
}
