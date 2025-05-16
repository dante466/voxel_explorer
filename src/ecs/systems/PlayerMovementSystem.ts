import { defineQuery, defineSystem, type System } from 'bitecs';
import type { IWorld } from 'bitecs';
import * as THREE from 'three';
import { Transform } from '../world';
import { CameraTarget } from '../components/CameraTarget';
import { FPS_EYE_HEIGHT } from './cameraSystem';
import { type ChunkManager } from '../../world/ChunkManager';

const PLAYER_SPEED_GROUND = 5.0; // meters/second
const PLAYER_SPEED_FLYING = 10.0; // meters/second
const JUMP_VELOCITY = 7.0; // meters/second
const GRAVITY = 20.0; // meters/second^2
const DEFAULT_TERRAIN_HEIGHT = 64; // From ChunkManager

export interface PlayerMovementSystemControls {
  system: System;
  cleanup: () => void;
  isFlying: () => boolean;
  toggleFlying: () => void;
}

// Temporary PlayerInput component to store key states
// In a more complex setup, this might come from a dedicated InputSystem that writes to an Input component
const keyStates: { [key: string]: boolean } = {};

export function createPlayerMovementSystem(
  world: IWorld,
  playerEntityId: number,
  gameDocument: Document, // For key listeners
  chunkManager: ChunkManager // Added chunkManager parameter
): PlayerMovementSystemControls {
  let currentIsFlying = true; // Default to flying
  let yVelocity = 0; // For gravity and jumping

  const onKeyDown = (event: KeyboardEvent) => {
    console.log(`PlayerMovementSystem: onKeyDown - ${event.code}`); // DEBUG LOG
    
    // Prevent default browser actions for game keys
    const gameKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ControlLeft', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (gameKeys.includes(event.code)) {
      event.preventDefault();
    }

    keyStates[event.code] = true;
    if (event.code === 'KeyF') { // Toggle flying with F key
      toggleFlyingLocal();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    console.log(`PlayerMovementSystem: onKeyUp - ${event.code}`); // DEBUG LOG
    keyStates[event.code] = false;
  };

  console.log('PlayerMovementSystem: Adding key listeners to document.'); // DEBUG LOG
  gameDocument.addEventListener('keydown', onKeyDown);
  gameDocument.addEventListener('keyup', onKeyUp);

  const playerQuery = defineQuery([Transform, CameraTarget]);

  const movementSystem = defineSystem((currentWorld: IWorld, delta: number) => {
    const entities = playerQuery(currentWorld);
    if (!entities.includes(playerEntityId)) return currentWorld;

    const eid = playerEntityId;

    console.log('PlayerMovementSystem: keyStates:', JSON.stringify(keyStates)); // UNCOMMENTED

    const moveDirection = new THREE.Vector3(0, 0, 0);
    const cameraYaw = CameraTarget.yaw[eid]; // Get current yaw from CameraTarget

    // Forward/Backward (W/S) movement based on player yaw
    if (keyStates['KeyW'] || keyStates['ArrowUp']) {
      moveDirection.z -= 1;
    }
    if (keyStates['KeyS'] || keyStates['ArrowDown']) {
      moveDirection.z += 1;
    }
    // Left/Right (A/D) strafe movement based on player yaw
    if (keyStates['KeyA'] || keyStates['ArrowLeft']) {
      moveDirection.x -= 1;
    }
    if (keyStates['KeyD'] || keyStates['ArrowRight']) {
      moveDirection.x += 1;
    }

    if (moveDirection.lengthSq() > 0) {
      console.log('PlayerMovementSystem: moveDirection (raw):', moveDirection.x, moveDirection.y, moveDirection.z); // UNCOMMENTED
    }

    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize();
      // Apply yaw to the horizontal movement direction
      moveDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
      console.log('PlayerMovementSystem: moveDirection (final):', moveDirection.x, moveDirection.y, moveDirection.z); // UNCOMMENTED
    }

    const speed = currentIsFlying ? PLAYER_SPEED_FLYING : PLAYER_SPEED_GROUND;
    const deltaX = moveDirection.x * speed * delta;
    const deltaZ = moveDirection.z * speed * delta;
    let deltaY = 0;

    Transform.position.x[eid] += deltaX;
    Transform.position.z[eid] += deltaZ;

    if (currentIsFlying) {
      yVelocity = 0; // Reset gravity effect while flying
      if (keyStates['Space']) {
        deltaY = speed * delta;
        Transform.position.y[eid] += deltaY;
      }
      if (keyStates['ShiftLeft'] || keyStates['ControlLeft']) {
        deltaY = -speed * delta;
        Transform.position.y[eid] += deltaY;
      }
    } else {
      const currentX = Transform.position.x[eid];
      const currentZ = Transform.position.z[eid];
      const terrainHeight = chunkManager.getHeightAtPosition(currentX, currentZ);
      console.log(`PlayerMovementSystem: Ground Mode - currentY: ${Transform.position.y[eid].toFixed(2)}, terrainHeight: ${terrainHeight}, yVelocity: ${yVelocity.toFixed(2)}`); // UNCOMMENTED

      // If terrain height is the default, assume chunk is not fully loaded for physics.
      // Keep player from falling through by effectively acting as if still flying for this frame regarding Y-axis.
      if (terrainHeight === DEFAULT_TERRAIN_HEIGHT) {
        // Maintain current yVelocity (which should be 0 if previously flying or reset by toggle)
        // or if player was falling, let them continue based on previous frame's non-default height.
        // Effectively, don't apply new gravity or floor collision based on default height.
        deltaY = yVelocity * delta;
        Transform.position.y[eid] += deltaY; // Apply existing momentum if any
        // (Optional: Could revert to currentIsFlying = true temporarily, but that has other side effects)
      } else {
        const targetPlayerYOnGround = terrainHeight + FPS_EYE_HEIGHT;
        const isOnGround = Transform.position.y[eid] <= targetPlayerYOnGround + 0.1 && yVelocity <= 0;

        if (keyStates['Space'] && isOnGround) {
          yVelocity = JUMP_VELOCITY;
        }

        yVelocity -= GRAVITY * delta;
        deltaY = yVelocity * delta;
        Transform.position.y[eid] += deltaY;

        if (Transform.position.y[eid] < targetPlayerYOnGround) {
          Transform.position.y[eid] = targetPlayerYOnGround;
          deltaY = targetPlayerYOnGround - (Transform.position.y[eid] - deltaY); // Recalculate actual deltaY
          yVelocity = 0;
        }
      }
    }
    if (deltaX !== 0 || deltaY !== 0 || deltaZ !== 0) { // UNCOMMENTED BLOCK
       console.log(`PlayerMovementSystem: PosChange dX:${deltaX.toFixed(2)}, dY:${deltaY.toFixed(2)}, dZ:${deltaZ.toFixed(2)}. NewPos X:${Transform.position.x[eid].toFixed(2)}, Y:${Transform.position.y[eid].toFixed(2)}, Z:${Transform.position.z[eid].toFixed(2)}`);
    }
    return currentWorld;
  });

  const cleanup = () => {
    console.log('PlayerMovementSystem: Removing key listeners from document.'); // DEBUG LOG
    gameDocument.removeEventListener('keydown', onKeyDown);
    gameDocument.removeEventListener('keyup', onKeyUp);
    console.log('PlayerMovementSystem cleaned up listeners.');
  };

  const toggleFlyingLocal = () => {
    currentIsFlying = !currentIsFlying;
    yVelocity = 0; // Reset velocity when changing mode
    console.log(`PlayerMovementSystem: Flying mode ${currentIsFlying ? 'enabled' : 'disabled'}`);
    // Update external state if needed (e.g., UI toggle in main.tsx)
    const flyingToggleInput = gameDocument.getElementById('flyingToggle') as HTMLInputElement;
    if (flyingToggleInput) flyingToggleInput.checked = currentIsFlying;
  };

  return {
    system: movementSystem,
    cleanup,
    isFlying: () => currentIsFlying,
    toggleFlying: toggleFlyingLocal,
  };
} 