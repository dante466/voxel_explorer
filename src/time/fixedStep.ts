/**
 * @file fixedStep.ts
 * Provides a utility to run a simulation callback at a fixed timestep (60Hz),
 * accumulating render frame deltas.
 */

const FIXED_HZ = 60;
export const FIXED_DT_S = 1 / FIXED_HZ;

let accumulator = 0;

// For FPS calculation
let simFrameCount = 0;
let lastFpsLogTime = 0;
let fpsLogInterval = 1000; // Log FPS every 1 second

/**
 * Runs the provided callback at a fixed timestep (default 60Hz).
 * 
 * @param frameDeltaSeconds The delta time from the last render frame, in seconds.
 *                          This is the variable time between two consecutive requestAnimationFrames.
 * @param simulationCallback The callback to execute for each fixed step. 
 *                           It receives the fixed delta time (e.g., 1/60s) as an argument.
 */
export function runFixedUpdate(
  frameDeltaSeconds: number,
  simulationCallback: (fixedDt: number) => void
): void {
  accumulator += frameDeltaSeconds;

  const now = performance.now();
  if (lastFpsLogTime === 0) {
    lastFpsLogTime = now; // Initialize on first call
  }

  // Sanity cap on frameDeltaSeconds to prevent spiral of death if game lags excessively
  // Max 250ms (4fps) worth of accumulation in one go, processing up to ~15 physics steps.
  if (frameDeltaSeconds > 0.25) {
    console.warn(`[FixedStep] Large frameDeltaSeconds detected: ${frameDeltaSeconds.toFixed(3)}s. Capping to 0.25s.`);
    accumulator = Math.min(accumulator, 0.25 + FIXED_DT_S); // Allow at least one step plus a bit extra from current large delta
  }

  while (accumulator >= FIXED_DT_S) {
    simulationCallback(FIXED_DT_S);
    accumulator -= FIXED_DT_S;
    simFrameCount++;
  }

  // Log sim FPS roughly every second
  if (now - lastFpsLogTime >= fpsLogInterval) {
    const elapsedRealSeconds = (now - lastFpsLogTime) / 1000;
    const averageSimFps = simFrameCount / elapsedRealSeconds;
    console.log(`[FixedStep] Sim FPS: ${averageSimFps.toFixed(1)} (ran ${simFrameCount} steps in ${elapsedRealSeconds.toFixed(2)}s)`);
    simFrameCount = 0;
    lastFpsLogTime = now;
  }
}

/**
 * Resets the accumulator and FPS logging state.
 * Useful if the simulation is paused or a scene is changed.
 */
export function resetFixedStepAccumulator(): void {
  accumulator = 0;
  simFrameCount = 0;
  lastFpsLogTime = 0; 
}

/**
 * Optional: Allows changing the interval for logging Sim FPS.
 * @param intervalMs Interval in milliseconds.
 */
export function setFpsLogInterval(intervalMs: number): void {
    fpsLogInterval = intervalMs;
} 