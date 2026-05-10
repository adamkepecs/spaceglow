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

assert.equal(game.getHudState().mode, "ended");
assert.ok(data.tapEvents.length > 0);
assert.ok(finished.some((trial) => trial.outcome === "hit"));
assert.equal(data.settings.levels.length, 3);
assert.equal(typeof data.summary.volatilityPenalty, "number");
assert.ok(game.getHudState().score > 0);

console.log("core smoke ok", {
  taps: data.tapEvents.length,
  trials: data.trials.length,
  endReason: data.endReason,
  score: game.getHudState().score,
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
