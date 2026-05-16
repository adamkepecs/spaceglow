import assert from "node:assert/strict";
import { SpaceGlowGame } from "../dist/game.js";

const game = new SpaceGlowGame({ width: 900, height: 620, seed: "smoke-test", debug: true });
game.setLevel("easy");

game.startDemo(false);
driveUntil(game, () => game.getHudState().mode === "start", 60 * 18);
assert.equal(game.getHudState().mode, "start");

game.startMeasured();
driveUntil(game, () => game.getHudState().mode === "ended", 60 * 130);

const data = game.getSessionData();
const finished = data.trials.filter((trial) => trial.outcome === "hit" || trial.outcome === "miss");
const hud = game.getHudState();

assert.equal(hud.mode, "ended");
assert.ok(data.tapEvents.length > 0);
assert.ok(finished.some((trial) => trial.outcome === "hit"));
assert.equal(data.settings.levels.length, 3);
assert.equal(typeof data.summary.volatilityPenalty, "number");
assert.ok(hud.maxShields >= 8);
assert.ok(hud.shields >= 0);
assert.ok(hud.shields <= hud.maxShields);
assert.equal(typeof hud.comboMultiplier, "number");
assert.ok(hud.score > 0);

const shieldGame = new SpaceGlowGame({ width: 900, height: 620, seed: "shield-test", debug: true });
shieldGame.setLevel("difficult");
shieldGame.startMeasured();

const startingShields = shieldGame.getHudState().shields;
let state = shieldGame.getRenderState();
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

function finishLaunch(game, maxFrames = 180) {
  let guard = 0;
  while (game.getRenderState().launchActive && game.getHudState().mode !== "ended" && guard < maxFrames) {
    game.update(1 / 60);
    guard += 1;
  }
}
