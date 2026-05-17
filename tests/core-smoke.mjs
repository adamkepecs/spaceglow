import assert from "node:assert/strict";
import { SpaceGlowGame } from "../dist/game.js";

const game = new SpaceGlowGame({ width: 900, height: 620, seed: "smoke-test", debug: true });
game.setLevel("easy");
let state;

game.startMeasured();
driveUntil(game, () => game.getHudState().waveNumber > 9, 60 * 180);
assert.equal(game.getHudState().mode, "running");
assert.ok(game.getHudState().waveNumber > 9);

depleteShields(game);
const data = game.getSessionData();
const finished = data.trials.filter((trial) => trial.outcome === "hit" || trial.outcome === "miss");
const hud = game.getHudState();

assert.equal(hud.mode, "ended");
assert.equal(hud.endReason, "shields-depleted");
assert.ok(data.tapEvents.length > 0);
assert.ok(finished.some((trial) => trial.outcome === "hit"));
assert.ok(data.settings.levels.length >= 9);
assert.equal(typeof data.summary.volatilityPenalty, "number");
assert.ok(hud.maxShields >= 8);
assert.ok(hud.shields >= 0);
assert.ok(hud.shields <= hud.maxShields);
assert.equal(typeof hud.comboMultiplier, "number");
assert.ok(hud.score > 0);
assert.equal(typeof hud.bestComboMultiplier, "number");
assert.equal(typeof hud.bullseyes, "number");
assert.equal(typeof hud.clutchSaves, "number");
assert.ok(hud.furthestWaveNumber > 9);

const supernovaGame = new SpaceGlowGame({ width: 900, height: 620, seed: "supernova-test", debug: true });
supernovaGame.startMeasured();
driveHits(supernovaGame, 10);
assert.equal(supernovaGame.getHudState().overdriveActive, true);

const clutchGame = new SpaceGlowGame({ width: 900, height: 620, seed: "clutch-test", debug: true });
clutchGame.startMeasured();
clutchGame.shields = 1;
state = clutchGame.getRenderState();
clutchGame.particleAngle = state.debug.idealLaunchAngle;
clutchGame.tap("forced-clutch");
finishLaunch(clutchGame);
assert.equal(clutchGame.getHudState().clutchSaves, 1);
assert.ok(clutchGame.getHudState().shields >= 4);

const shieldGame = new SpaceGlowGame({ width: 900, height: 620, seed: "shield-test", debug: true });
shieldGame.setLevel("difficult");
shieldGame.startMeasured();

const startingShields = shieldGame.getHudState().shields;
assert.equal(startingShields, 8);
state = shieldGame.getRenderState();
shieldGame.particleAngle = state.debug.idealLaunchAngle + Math.PI;
shieldGame.tap("forced-miss");
finishLaunch(shieldGame);
const afterMiss = shieldGame.getHudState().shields;
assert.ok(afterMiss < startingShields);

state = shieldGame.getRenderState();
shieldGame.particleAngle = state.debug.idealLaunchAngle;
shieldGame.tap("forced-hit");
finishLaunch(shieldGame);
const afterHit = shieldGame.getHudState().shields;
assert.ok(afterHit >= afterMiss);
assert.ok(afterHit <= shieldGame.getHudState().maxShields);

const rapidGame = new SpaceGlowGame({ width: 900, height: 620, seed: "rapid-test", debug: true });
rapidGame.setLevel("easy");
rapidGame.startMeasured();
state = rapidGame.getRenderState();
rapidGame.particleAngle = state.debug.idealLaunchAngle;
rapidGame.tap("launch");
const duringLaunchShields = rapidGame.getHudState().shields;
rapidGame.tap("extra-rapid");
assert.equal(rapidGame.getHudState().shields, duringLaunchShields);
finishLaunch(rapidGame);

const depletionGame = new SpaceGlowGame({ width: 900, height: 620, seed: "depletion-test", debug: true });
depletionGame.setLevel("difficult");
depletionGame.startMeasured();
while (depletionGame.getHudState().mode === "running") {
  const missState = depletionGame.getRenderState();
  depletionGame.particleAngle = missState.debug.idealLaunchAngle + Math.PI;
  depletionGame.tap("forced-depletion-miss");
  finishLaunch(depletionGame);
}
assert.equal(depletionGame.getHudState().endReason, "shields-depleted");

console.log("core smoke ok", {
  taps: data.tapEvents.length,
  trials: data.trials.length,
  endReason: data.endReason,
  score: hud.score,
  volatilityPenalty: data.summary.volatilityPenalty,
});

function driveUntil(game, done, maxFrames) {
  let guard = 0;
  while (!done() && guard < maxFrames) {
    const state = game.getRenderState();
    if (
      (state.mode === "demo" || state.mode === "running") &&
      !state.launchActive &&
      Math.abs(state.debug.timingDifferenceSeconds) < 0.018
    ) {
      game.tap("smoke");
    }
    game.update(1 / 60);
    guard += 1;
  }
}

function driveHits(game, hits) {
  let landed = 0;
  let guard = 0;
  while (landed < hits && guard < 60 * 180) {
    const state = game.getRenderState();
    if (state.mode === "levelComplete") {
      game.update(1 / 60);
    } else if (state.mode === "running" && !state.launchActive) {
      game.particleAngle = state.debug.idealLaunchAngle;
      game.tap("forced-hit");
      finishLaunch(game);
      landed += 1;
    } else {
      game.update(1 / 60);
    }
    guard += 1;
  }
  assert.equal(landed, hits);
}

function depleteShields(game) {
  let guard = 0;
  while (game.getHudState().mode !== "ended" && guard < 60 * 180) {
    const state = game.getRenderState();
    if (state.mode === "levelComplete") {
      game.update(1 / 60);
    } else if (state.mode === "running" && !state.launchActive) {
      game.particleAngle = state.debug.idealLaunchAngle + Math.PI;
      game.tap("forced-depletion-miss");
      finishLaunch(game);
    } else {
      game.update(1 / 60);
    }
    guard += 1;
  }
}

function finishLaunch(game, maxFrames = 180) {
  let guard = 0;
  while (game.getRenderState().launchActive && game.getHudState().mode !== "ended" && guard < maxFrames) {
    game.update(1 / 60);
    guard += 1;
  }
}
