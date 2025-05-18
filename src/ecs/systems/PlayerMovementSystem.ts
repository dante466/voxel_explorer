import { defineQuery, defineSystem, type System } from 'bitecs';
import type { IWorld } from 'bitecs';
import * as THREE from 'three';
import { Transform } from '../world';
import { CameraTarget } from '../components/CameraTarget';
import { type ChunkManager } from '../../world/ChunkManager';
import { FIXED_DT_S } from '../../time/fixedStep.js';
import { resolveAABBvoxelCollision } from '../../physics/voxelCollide';
import { CHUNK_SIZE } from '../../world/Chunk.js'; // Added for Triage Kit 2-B helper

export const PLAYER_SPEED_GROUND = 6.0; // meters/second (Aligned with server MAX_SPEED)
export const PLAYER_SPEED_FLYING = 10.0; // meters/second
export const JUMP_VELOCITY = 7.0; // meters/second
export const GRAVITY = 9.81; // meters/second^2 (Aligned with server gravity)
const DEFAULT_TERRAIN_HEIGHT = 64; // From ChunkManager
const CLIENT_GROUND_DAMP = 0.90; // C1-1: Matches server GROUND_DAMP
const CLIENT_AIR_DAMP = 0.99;    // C1-1: Matches server AIR_DAMP (though not explicitly used for horizontal yet)

// Consistent player height model with server (origin at center of 1.8m total height)
const CLIENT_PLAYER_TOTAL_HEIGHT = 1.8; // Matches server PLAYER_HEIGHT
const CLIENT_PLAYER_HALF_HEIGHT = CLIENT_PLAYER_TOTAL_HEIGHT / 2; // 0.9m

// Interface for the input state to the movement calculation logic
export interface PlayerMovementInputState {
  currentPosition: THREE.Vector3;
  currentHorizontalVelocity: THREE.Vector2; // C1-1: Added
  currentYVelocity: number;
  currentIsFlying: boolean;
  cameraYaw: number;
  keys: { [key: string]: boolean }; // Key states relevant for movement (W,A,S,D,Space,Shift)
  chunkManager: ChunkManager;
  getIsOnGround: () => boolean;
}

// Interface for the output state from the movement calculation logic
export interface PlayerMovementOutputState {
  newPosition: THREE.Vector3;
  newYVelocity: number;
  horizontalVelocity: THREE.Vector2; // This now represents the hVel at the END of the tick
}

// Extracted core movement logic
export function calculatePlayerMovement(input: PlayerMovementInputState): PlayerMovementOutputState {
  const { 
    currentPosition, 
    currentHorizontalVelocity, // C1-1: Use this
    currentYVelocity, 
    currentIsFlying, 
    cameraYaw, 
    keys, 
    chunkManager,
    getIsOnGround
  } = input;
  
  const newPos = currentPosition.clone(); // newPos will be modified for X, Z, and then Y.
  let newYVel = currentYVelocity; // Start with current Y velocity.
  let hVel = currentHorizontalVelocity.clone(); // C1-1: Start with current hVel and modify it

  const moveDirection = new THREE.Vector3(0, 0, 0);
  const hasMovementInput = keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown'] || keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight'];

  if (hasMovementInput) {
    if (keys['KeyW'] || keys['ArrowUp']) moveDirection.z -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) moveDirection.z += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) moveDirection.x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveDirection.x += 1;

    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize();
      moveDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
    }
  }

  const currentSpeed = currentIsFlying ? PLAYER_SPEED_FLYING : PLAYER_SPEED_GROUND;

  // C1-1: Update hVel based on input or damping
  if (hasMovementInput) {
    hVel.set(moveDirection.x * currentSpeed, moveDirection.z * currentSpeed);
  } else {
    if (currentIsFlying) {
      // Horizontal air damping - for now, let's assume instant stop like before if no input, matching server
      // If smooth air deceleration is desired: hVel.multiplyScalar(CLIENT_AIR_DAMP);
      // For P0-1, server also makes flying horizontal stop instantly if no input.
      // So to match that, if not applying CLIENT_AIR_DAMP:
      hVel.set(0,0); // Instant horizontal stop when flying and no input, to match server's current flying logic
    } else {
      hVel.multiplyScalar(CLIENT_GROUND_DAMP);
    }
  }
  
  // Use the (potentially damped) hVel for position change
  const deltaX = hVel.x * FIXED_DT_S;
  const deltaZ = hVel.y * FIXED_DT_S; // .y of Vector2 (hVel) is Z-axis movement
  let deltaY = 0; // Will be calculated based on newYVel later

  newPos.x += deltaX;
  newPos.z += deltaZ;
  // newPos.y is still currentPosition.y at this point

  if (currentIsFlying) {
    newYVel = 0; // Reset gravity effect while flying
    if (keys['Space']) {
        // deltaY = PLAYER_SPEED_FLYING / 2 * FIXED_DT_S; // This was direct position manipulation
        newPos.y += PLAYER_SPEED_FLYING / 2 * FIXED_DT_S; // Apply delta directly
    } else if (keys['ShiftLeft'] || keys['ControlLeft']) {
        // deltaY = -PLAYER_SPEED_FLYING / 2 * FIXED_DT_S;
        newPos.y -= PLAYER_SPEED_FLYING / 2 * FIXED_DT_S; // Apply delta directly
    }
    // No gravity or complex Y velocity changes in flying mode for now.
  } else { // Grounded movement physics
    // newPos.y is implicitly currentPosition.y here to start grounded physics calculations for the tick.
    const isOnGroundForThisTick = input.getIsOnGround(); // Corrected: Use input.getIsOnGround()

    // 1. Determine baseline terrain interaction points based on new XZ (used for final sticking)
    const yOfHighestBlockBeneath = chunkManager.getHeightAtPosition(newPos.x, newPos.z);
    let targetPlayerYOnGroundFromHeightAt: number | null = null;
    if (yOfHighestBlockBeneath !== null) {
      // Assuming yOfHighestBlockBeneath is Y_of_block, surface is Y_of_block + 0.5 (experiment)
      const actualGroundSurfaceY = yOfHighestBlockBeneath + 0.5; 
      targetPlayerYOnGroundFromHeightAt = actualGroundSurfaceY + CLIENT_PLAYER_HALF_HEIGHT;
    }
    console.log(`[PMS CalcMove] Inputs: newPos.xz(${newPos.x.toFixed(2)}, ${newPos.z.toFixed(2)}), yOfBlockBeneath: ${yOfHighestBlockBeneath}, targetPlayerYOnGroundFromHeightAt: ${targetPlayerYOnGroundFromHeightAt?.toFixed(2)}`);

    // 2. Jump Logic
    let didJumpThisTick = false;
    if (isOnGroundForThisTick) { // NEW: Use reliable ground state from input.getIsOnGround()
      if (keys['Space']) { // Note: lacks !prevKeys check for single press, consistent with prior.
        newYVel = JUMP_VELOCITY;
        didJumpThisTick = true;
      }
    }

    // 3. Triage Kit 2-B: Ground-snap logic
    let snappedToGroundThisTick = false;
    if (!didJumpThisTick && currentYVelocity <= 0.0 && isOnGroundForThisTick) { // NEW: Added isOnGroundForThisTick
      const playerCapsuleBottomYForSnap = currentPosition.y - CLIENT_PLAYER_HALF_HEIGHT;
      const highestFootprintSurfaceY = getHighestGroundSurfaceInFootprint(currentPosition, chunkManager, playerCapsuleBottomYForSnap);
      console.log(`[PMS CalcMove SnapAttempt] curPos: ${currentPosition.y.toFixed(2)}, capBottomForSnap: ${playerCapsuleBottomYForSnap.toFixed(2)}, highestFootprintSurfaceY: ${highestFootprintSurfaceY?.toFixed(2)}`);

      if (highestFootprintSurfaceY !== null) {
        const playerFeetY = currentPosition.y - CLIENT_PLAYER_HALF_HEIGHT;
        if (highestFootprintSurfaceY > playerFeetY && (highestFootprintSurfaceY - playerFeetY) <= 0.25) {
          newPos.y = highestFootprintSurfaceY + CLIENT_PLAYER_HALF_HEIGHT; // Snap directly updates newPos.y
          newYVel = 0; // Stop velocity due to snap
          snappedToGroundThisTick = true;
          // console.log(`[MoveSys 2-B Snap] Snapped to Y: ${newPos.y.toFixed(2)} from PlayerFeetY: ${playerFeetY.toFixed(2)}, FootprintSurf: ${highestFootprintSurfaceY.toFixed(2)}`);
        }
      }
    }

    // 4. Apply Gravity and Final Ground Collision (if not snapped)
    if (!snappedToGroundThisTick) {
      // If didJumpThisTick, newYVel is JUMP_VELOCITY. Otherwise, it's currentYVelocity.
      // Apply gravity to this velocity.
      newYVel -= GRAVITY * FIXED_DT_S;
      
      deltaY = newYVel * FIXED_DT_S;
      newPos.y += deltaY; // newPos.y was currentPosition.y, now add effect of gravity/jump for this tick.

      // Final ground collision and sticking, only if there's a ground to collide with
      if (targetPlayerYOnGroundFromHeightAt !== null) {
          if (newPos.y < targetPlayerYOnGroundFromHeightAt) {
              newPos.y = targetPlayerYOnGroundFromHeightAt;
              newYVel = 0; // Landed
          }
      }
      // If targetPlayerYOnGroundFromHeightAt is null (over a void), free fall happens, newPos.y is already updated.
    }
    // If snappedToGroundThisTick, newPos.y was already set by the snap, and newYVel is 0.
    // deltaY effectively remains 0 for this tick's direct application if snapped.
  }

  // newPos contains the calculated X, Z, and Y before final collision resolution.

  let finalNewPosition: THREE.Vector3;
  if (currentIsFlying) {
    finalNewPosition = newPos; // If flying, use the position determined by velocity application directly
  } else {
    // If not flying, apply AABB voxel collision detection and resolution
    finalNewPosition = resolveAABBvoxelCollision(newPos, chunkManager);
  }

  // The horizontalVelocity in output state is the new hVel for the next frame
  // newYVelocity is the Y velocity after this tick's physics (jump, gravity, snap, landing)
  return { newPosition: finalNewPosition, newYVelocity: newYVel, horizontalVelocity: hVel };
}

// Helper function for Triage Kit 2-B: Find highest ground surface in 3x3 footprint
function getHighestGroundSurfaceInFootprint(
  centerPos: THREE.Vector3,
  chunkManager: ChunkManager,
  playerCapsuleBottomY: number // To limit how far down we scan
): number | null {
  let maxGroundSurfaceY = -Infinity;
  const floorPlayerX = Math.floor(centerPos.x);
  const floorPlayerZ = Math.floor(centerPos.z);
  let foundGround = false;
  // Log inputs to getHighestGroundSurfaceInFootprint
  console.log(`[PMS GetHighestSurf] centerPos: (${centerPos.x.toFixed(2)}, ${centerPos.y.toFixed(2)}, ${centerPos.z.toFixed(2)}), playerCapsuleBottomY: ${playerCapsuleBottomY.toFixed(2)}`);

  for (let dx = -1; dx <= 1; dx++) { // Check 3x3 columns
    for (let dz = -1; dz <= 1; dz++) {
      const voxelX = floorPlayerX + dx;
      const voxelZ = floorPlayerZ + dz;

      // Scan downwards from just above player's capsule bottom in this column
      for (let scanY = Math.floor(playerCapsuleBottomY + 1); scanY >= 0; scanY--) {
        const blockId = getBlockIdAtWorldPosFromPMS(chunkManager, voxelX, scanY, voxelZ); // Use local helper
        if (blockId > 0) { // If solid
          const topOfBlockSurfaceY = scanY + 0.5; // Surface is Y_of_block + 0.5 (experiment)
          if (topOfBlockSurfaceY > maxGroundSurfaceY) {
            maxGroundSurfaceY = topOfBlockSurfaceY;
            foundGround = true;
            // Log when a new maxGroundSurfaceY is found
            console.log(`[PMS GetHighestSurf] Found block at (${voxelX}, ${scanY}, ${voxelZ}), new maxGroundSurfaceY (mid of block): ${maxGroundSurfaceY}`);
          }
          break; // Found highest solid in this column
        }
      }
    }
  }
  return foundGround ? maxGroundSurfaceY : null;
}

// Minimal helper to get block ID, adapted from voxelCollide.ts for use within PlayerMovementSystem
// This avoids needing to export it from voxelCollide or pass chunkManager.getChunkData around too much
function getBlockIdAtWorldPosFromPMS(chunkManager: ChunkManager, worldX: number, worldY: number, worldZ: number): number {
  if (worldY < 0 || worldY >= CHUNK_SIZE.HEIGHT) { // CHUNK_SIZE needs to be accessible
      return 0; 
  }
  const chunkCX = Math.floor(worldX / CHUNK_SIZE.WIDTH);
  const chunkCZ = Math.floor(worldZ / CHUNK_SIZE.DEPTH);
  const chunk = chunkManager.getChunkData(`${chunkCX},${chunkCZ}`);
  if (!chunk) {
      return 0; 
  }
  const localX = ((worldX % CHUNK_SIZE.WIDTH) + CHUNK_SIZE.WIDTH) % CHUNK_SIZE.WIDTH;
  const localZ = ((worldZ % CHUNK_SIZE.DEPTH) + CHUNK_SIZE.DEPTH) % CHUNK_SIZE.DEPTH;
  return chunk.getVoxel(localX, worldY, localZ);
}

export interface PlayerMovementSystemControls {
  system: System;
  cleanup: () => void;
  isFlying: () => boolean;
  toggleFlying: () => void;
  isOnGround: () => boolean;
  setServerGroundedState: (isGrounded: boolean) => void;
  getCurrentYVelocity: () => number;
  getCurrentHorizontalVelocity: () => THREE.Vector2; // C1-1: Added
  getKeyStates: () => { [key: string]: boolean }; 
}

const keyStates: { [key: string]: boolean } = {};

export function createPlayerMovementSystem(
  world: IWorld,
  playerEntityId: number,
  gameDocument: Document,
  chunkManager: ChunkManager
): PlayerMovementSystemControls {
  let currentIsFlying = false;
  let yVelocity = 0;
  let horizontalVelocity = new THREE.Vector2(0, 0); // C1-1: Persistent horizontal velocity
  let serverSaysOnGround: boolean | null = null; // Triage Kit 1-A: Store server state

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

    tempCurrentPosition.set(Transform.position.x[eid], Transform.position.y[eid], Transform.position.z[eid]);
    const inputState: PlayerMovementInputState = {
      currentPosition: tempCurrentPosition,
      currentHorizontalVelocity: horizontalVelocity.clone(), // C1-1: Pass current hVel
      currentYVelocity: yVelocity,
      currentIsFlying: currentIsFlying,
      cameraYaw: CameraTarget.yaw[eid],
      keys: { ...keyStates }, 
      chunkManager: chunkManager,
      getIsOnGround: () => {
        // Triage Kit 1-A: Prioritize server state
        if (serverSaysOnGround !== null) {
          return serverSaysOnGround;
        }
        // Fallback to client calculation if server state unknown (e.g., pre-connection or if snapshot missing)
        const currentPositionVec = new THREE.Vector3(
          Transform.position.x[playerEntityId],
          Transform.position.y[playerEntityId],
          Transform.position.z[playerEntityId]
        );
        const yOfBlock = chunkManager.getHeightAtPosition(currentPositionVec.x, currentPositionVec.z);
        
        if (yOfBlock === null) {
          return false; // Cannot be on ground if terrain height is unknown
        }

        // Assuming yOfBlock is Y_of_block, surface is Y_of_block + 1
        const actualGroundSurfaceY = yOfBlock + 1;
        const calculatedTargetCenterY = actualGroundSurfaceY + CLIENT_PLAYER_HALF_HEIGHT;
        
        // Triage Kit 1-B: Align ground-check epsilons (e.g. 0.15m for snap tolerance)
        return Math.abs(currentPositionVec.y - calculatedTargetCenterY) < 0.15;
      },
    };

    const outputState = calculatePlayerMovement(inputState);

    Transform.position.x[eid] = outputState.newPosition.x;
    Transform.position.z[eid] = outputState.newPosition.z;
    
    // Client only directly applies Y position changes if flying OR if not flying but Y changed due to local physics (jump/gravity)
    // This is tricky because server is authoritative. If client calculated Y based on its own collision/gravity
    // and server does too, they might differ. For now, let client apply its calculated Y.
    // The server correction will handle discrepancies.
    Transform.position.y[eid] = outputState.newPosition.y;
    
    yVelocity = outputState.newYVelocity;
    horizontalVelocity.copy(outputState.horizontalVelocity); // C1-1: Update persistent hVel
        
    // C2-1 Success Check: Log client's calculated horizontal velocity (now from the persistent hVel)
    // Define hasMovementInput within this scope based on keyStates for logging purposes
    const hasActiveInputForLogging = !!(keyStates['KeyW'] || keyStates['ArrowUp'] || 
                                 keyStates['KeyS'] || keyStates['ArrowDown'] || 
                                 keyStates['KeyA'] || keyStates['ArrowLeft'] || 
                                 keyStates['KeyD'] || keyStates['ArrowRight']);

    if (hasActiveInputForLogging || horizontalVelocity.lengthSq() > 0.001) { // Also log if coasting or if there was input
      console.log(`[Client C1-1 DEBUG] hVel: x=${horizontalVelocity.x.toFixed(2)}, z=${horizontalVelocity.y.toFixed(2)}, isFlying: ${currentIsFlying}, Input: ${hasActiveInputForLogging}`);
    }

    return currentWorld;
  });

  const cleanup = () => {
    gameDocument.removeEventListener('keydown', onKeyDown);
    gameDocument.removeEventListener('keyup', onKeyUp);
    console.log('PlayerMovementSystem cleaned up listeners.');
  };

  const toggleFlyingLocal = () => {
    currentIsFlying = !currentIsFlying;
    yVelocity = 0; 
    horizontalVelocity.set(0, 0); // C1-1: Reset hVel on mode change
    console.log(`PlayerMovementSystem: Flying mode ${currentIsFlying ? 'enabled' : 'disabled'}`);
    const flyingToggleInput = gameDocument.getElementById('flyingToggle') as HTMLInputElement;
    if (flyingToggleInput) flyingToggleInput.checked = currentIsFlying;
  };

  const getIsOnGround = (): boolean => {
    // Triage Kit 1-A: Prioritize server state
    if (serverSaysOnGround !== null) {
      return serverSaysOnGround;
    }
    // Fallback to client calculation if server state unknown (e.g., pre-connection or if snapshot missing)
    const currentPositionVec = new THREE.Vector3(
      Transform.position.x[playerEntityId],
      Transform.position.y[playerEntityId],
      Transform.position.z[playerEntityId]
    );
    const yOfBlock = chunkManager.getHeightAtPosition(currentPositionVec.x, currentPositionVec.z);
    
    if (yOfBlock === null) {
      return false; // Cannot be on ground if terrain height is unknown
    }

    // Assuming yOfBlock is Y_of_block, surface is Y_of_block + 1
    const actualGroundSurfaceY = yOfBlock + 1;
    const calculatedTargetCenterY = actualGroundSurfaceY + CLIENT_PLAYER_HALF_HEIGHT;
    
    // Triage Kit 1-B: Align ground-check epsilons (e.g. 0.15m for snap tolerance)
    return Math.abs(currentPositionVec.y - calculatedTargetCenterY) < 0.15;
  };

  const setServerGrounded = (isGrounded: boolean) => {
    serverSaysOnGround = isGrounded;
  };

  const getCurrentYVelocity = (): number => yVelocity;

  return {
    system: movementSystem,
    cleanup,
    isFlying: () => currentIsFlying,
    toggleFlying: toggleFlyingLocal,
    isOnGround: getIsOnGround,
    setServerGroundedState: setServerGrounded,
    getCurrentYVelocity,
    getCurrentHorizontalVelocity: () => horizontalVelocity.clone(), // C1-1: Expose hVel
    getKeyStates: () => ({ ...keyStates }),
  };
} 