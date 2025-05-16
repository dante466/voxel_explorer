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

// Interface for the input state to the movement calculation logic
export interface PlayerMovementInputState {
  currentPosition: THREE.Vector3;
  currentYVelocity: number;
  currentIsFlying: boolean;
  cameraYaw: number;
  keys: { [key: string]: boolean }; // Key states relevant for movement (W,A,S,D,Space,Shift)
  deltaTime: number;
  chunkManager: ChunkManager;
}

// Interface for the output state from the movement calculation logic
export interface PlayerMovementOutputState {
  newPosition: THREE.Vector3;
  newYVelocity: number;
  // newIsFlying is not returned here; flying state is toggled by a separate action
}

// Extracted core movement logic
export function calculatePlayerMovement(input: PlayerMovementInputState): PlayerMovementOutputState {
  const { currentPosition, currentYVelocity, currentIsFlying, cameraYaw, keys, deltaTime, chunkManager } = input;
  
  const newPos = currentPosition.clone();
  let newYVel = currentYVelocity;

  const moveDirection = new THREE.Vector3(0, 0, 0);

  if (keys['KeyW'] || keys['ArrowUp']) {
    moveDirection.z -= 1;
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    moveDirection.z += 1;
  }
  if (keys['KeyA'] || keys['ArrowLeft']) {
    moveDirection.x -= 1;
  }
  if (keys['KeyD'] || keys['ArrowRight']) {
    moveDirection.x += 1;
  }

  if (moveDirection.lengthSq() > 0) {
    moveDirection.normalize();
    moveDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
  }

  const speed = currentIsFlying ? PLAYER_SPEED_FLYING : PLAYER_SPEED_GROUND;
  const deltaX = moveDirection.x * speed * deltaTime;
  const deltaZ = moveDirection.z * speed * deltaTime;
  let deltaY = 0;

  newPos.x += deltaX;
  newPos.z += deltaZ;

  if (currentIsFlying) {
    newYVel = 0; // Reset gravity effect while flying
    if (keys['Space']) {
      deltaY = speed * deltaTime;
      newPos.y += deltaY;
    }
    if (keys['ShiftLeft'] || keys['ControlLeft']) {
      deltaY = -speed * deltaTime;
      newPos.y += deltaY;
    }
  } else {
    const terrainHeight = chunkManager.getHeightAtPosition(newPos.x, newPos.z);

    if (terrainHeight === DEFAULT_TERRAIN_HEIGHT) {
      deltaY = newYVel * deltaTime;
      newPos.y += deltaY;
    } else {
      const targetPlayerYOnGround = terrainHeight + FPS_EYE_HEIGHT;
      const isOnGround = newPos.y <= targetPlayerYOnGround + 0.1 && newYVel <= 0;

      if (keys['Space'] && isOnGround) {
        newYVel = JUMP_VELOCITY;
      }

      newYVel -= GRAVITY * deltaTime;
      deltaY = newYVel * deltaTime;
      newPos.y += deltaY;

      if (newPos.y < targetPlayerYOnGround) {
        newPos.y = targetPlayerYOnGround;
        newYVel = 0;
      }
    }
  }
  return { newPosition: newPos, newYVelocity: newYVel };
}

export interface PlayerMovementSystemControls {
  system: System;
  cleanup: () => void;
  isFlying: () => boolean;
  toggleFlying: () => void;
  // Expose keyStates for NetworkManager to capture for pending inputs
  getKeyStates: () => { [key: string]: boolean }; 
}

const keyStates: { [key: string]: boolean } = {};

export function createPlayerMovementSystem(
  world: IWorld,
  playerEntityId: number,
  gameDocument: Document,
  chunkManager: ChunkManager
): PlayerMovementSystemControls {
  let currentIsFlying = true;
  let yVelocity = 0;

  const onKeyDown = (event: KeyboardEvent) => {
    const gameKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ControlLeft', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (gameKeys.includes(event.code)) {
      event.preventDefault();
    }
    keyStates[event.code] = true;
    if (event.code === 'KeyF') {
      toggleFlyingLocal();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    keyStates[event.code] = false;
  };

  gameDocument.addEventListener('keydown', onKeyDown);
  gameDocument.addEventListener('keyup', onKeyUp);

  const playerQuery = defineQuery([Transform, CameraTarget]);
  const tempCurrentPosition = new THREE.Vector3(); // For passing to calculatePlayerMovement

  const movementSystem = defineSystem((currentWorld: IWorld, delta: number) => {
    const entities = playerQuery(currentWorld);
    if (!entities.includes(playerEntityId)) return currentWorld;

    const eid = playerEntityId;

    // Prepare input for calculatePlayerMovement
    tempCurrentPosition.set(Transform.position.x[eid], Transform.position.y[eid], Transform.position.z[eid]);
    const inputState: PlayerMovementInputState = {
      currentPosition: tempCurrentPosition,
      currentYVelocity: yVelocity,
      currentIsFlying: currentIsFlying,
      cameraYaw: CameraTarget.yaw[eid],
      keys: { ...keyStates }, // Pass a copy of relevant key states
      deltaTime: delta,
      chunkManager: chunkManager,
    };

    const outputState = calculatePlayerMovement(inputState);

    // Update ECS Transform component
    Transform.position.x[eid] = outputState.newPosition.x;
    Transform.position.y[eid] = outputState.newPosition.y;
    Transform.position.z[eid] = outputState.newPosition.z;

    // Update internal state for next frame
    yVelocity = outputState.newYVelocity;
    // currentIsFlying is updated by toggleFlyingLocal directly
    
    // Optional: Log position changes (already existed in original code)
    // if (outputState.newPosition.distanceToSquared(tempCurrentPosition) > 0.0001) {
    //   console.log(`PlayerMovementSystem: PosChange ... NewPos X:${Transform.position.x[eid].toFixed(2)}, Y:${Transform.position.y[eid].toFixed(2)}, Z:${Transform.position.z[eid].toFixed(2)}`);
    // }

    return currentWorld;
  });

  const cleanup = () => {
    gameDocument.removeEventListener('keydown', onKeyDown);
    gameDocument.removeEventListener('keyup', onKeyUp);
    console.log('PlayerMovementSystem cleaned up listeners.');
  };

  const toggleFlyingLocal = () => {
    currentIsFlying = !currentIsFlying;
    yVelocity = 0; // Reset velocity when changing mode
    console.log(`PlayerMovementSystem: Flying mode ${currentIsFlying ? 'enabled' : 'disabled'}`);
    const flyingToggleInput = gameDocument.getElementById('flyingToggle') as HTMLInputElement;
    if (flyingToggleInput) flyingToggleInput.checked = currentIsFlying;
  };

  return {
    system: movementSystem,
    cleanup,
    isFlying: () => currentIsFlying,
    toggleFlying: toggleFlyingLocal,
    getKeyStates: () => ({ ...keyStates }), // Return a copy
  };
} 