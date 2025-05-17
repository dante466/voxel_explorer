import { defineQuery, defineSystem } from 'bitecs';
import type { IWorld } from 'bitecs';
import * as THREE from 'three';
import { CameraTarget } from '../components/CameraTarget';
import { CameraMode } from '../types';
// Import zoom constants from cameraSystem
import { ZOOM_MIN, ZOOM_MAX, DEFAULT_ZOOM } from './CameraSystem';

const MOUSE_SENSITIVITY_X = 0.002;
const MOUSE_SENSITIVITY_Y = 0.002; // Can be different if needed, e.g. for inversion
const ZOOM_SENSITIVITY = 0.1; // Adjust as needed for mouse wheel zoom speed

const FPS_PITCH_MIN_RAD = THREE.MathUtils.degToRad(-89);
const FPS_PITCH_MAX_RAD = THREE.MathUtils.degToRad(89);
// TPS pitch might have different limits, but for now, we use the same.

export function createInputLookSystem(world: IWorld, gameDocument: Document, debugMode: boolean) {
  let accumulatedMouseDeltaX = 0;
  let accumulatedMouseDeltaY = 0;
  // No need to accumulate wheel delta, apply immediately

  const onMouseMove = (event: MouseEvent) => {
    if (gameDocument.pointerLockElement) {
      accumulatedMouseDeltaX += event.movementX;
      accumulatedMouseDeltaY += event.movementY;
    }
  };

  const onMouseWheel = (event: WheelEvent) => {
    if (gameDocument.pointerLockElement) { // Optional: Zoom might be desired even without pointer lock
      event.preventDefault(); // Prevent page scrolling
      const entities = cameraTargetQuery(world); // Get entities within this event handler
      for (const eid of entities) {
        if (CameraTarget.mode[eid] === CameraMode.TPS) { // Only zoom in TPS mode
          let newZoom = CameraTarget.zoom[eid] + event.deltaY * ZOOM_SENSITIVITY;
          CameraTarget.zoom[eid] = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
          // console.log(`InputLookSystem: Entity ${eid} TPS Zoom: ${CameraTarget.zoom[eid].toFixed(2)}`); // DEBUG LOG
        }
      }
    }
  };

  gameDocument.addEventListener('mousemove', onMouseMove, false);
  gameDocument.addEventListener('wheel', onMouseWheel, { passive: false }); // passive: false for preventDefault

  const cameraTargetQuery = defineQuery([CameraTarget]);

  const inputLookSystem = defineSystem((currentWorld: IWorld) => {
    const entities = cameraTargetQuery(currentWorld);

    for (const eid of entities) {
      // Update Yaw and Pitch for both FPS and TPS modes
      if (CameraTarget.mode[eid] === CameraMode.FPS || CameraTarget.mode[eid] === CameraMode.TPS) {
        const oldYaw = CameraTarget.yaw[eid]; // Store old values for comparison
        const oldPitch = CameraTarget.pitch[eid];

        CameraTarget.yaw[eid] -= accumulatedMouseDeltaX * MOUSE_SENSITIVITY_X;
        CameraTarget.pitch[eid] -= accumulatedMouseDeltaY * MOUSE_SENSITIVITY_Y;

        CameraTarget.pitch[eid] = Math.max(
          FPS_PITCH_MIN_RAD, 
          Math.min(FPS_PITCH_MAX_RAD, CameraTarget.pitch[eid])
        );

        // Log only if in debugMode and if there was an actual change in yaw/pitch due to mouse input
        if (debugMode && (accumulatedMouseDeltaX !== 0 || accumulatedMouseDeltaY !== 0)) {
          // Further check if yaw or pitch actually changed after sensitivity & clamping, 
          // though mouse delta check is usually sufficient for "intent to look"
          if (CameraTarget.yaw[eid] !== oldYaw || CameraTarget.pitch[eid] !== oldPitch) {
            const modeStr = CameraTarget.mode[eid] === CameraMode.FPS ? 'FPS' : 'TPS';
            // console.log(`InputLookSystem: Entity ${eid} ${modeStr} - Yaw: ${THREE.MathUtils.radToDeg(CameraTarget.yaw[eid]).toFixed(2)}°, Pitch: ${THREE.MathUtils.radToDeg(CameraTarget.pitch[eid]).toFixed(2)}° (DeltaX: ${accumulatedMouseDeltaX}, DeltaY: ${accumulatedMouseDeltaY})`);
          }
        }
      }
    }

    accumulatedMouseDeltaX = 0;
    accumulatedMouseDeltaY = 0;

    return currentWorld;
  });

  (inputLookSystem as any).cleanup = () => {
    gameDocument.removeEventListener('mousemove', onMouseMove, false);
    gameDocument.removeEventListener('wheel', onMouseWheel, false); 
    console.log('InputLookSystem: Mouse move and wheel listeners cleaned up.');
  };

  return inputLookSystem;
} 