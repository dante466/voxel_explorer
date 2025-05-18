import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { calculatePlayerMovement, type PlayerMovementInputState, PLAYER_SPEED_GROUND } from '../../../src/ecs/systems/PlayerMovementSystem';
import { FIXED_DT_S } from '../../../src/time/fixedStep';
import type { ChunkManager } from '../../../src/world/ChunkManager';

// Mock ChunkManager for the test
const mockChunkManager = {
  getHeightAtPosition: vi.fn().mockReturnValue(0), // Assume flat ground at Y=0 for simplicity
  // Add other methods if calculatePlayerMovement starts using them more extensively
} as unknown as ChunkManager;

describe('PlayerMovementSystem: calculatePlayerMovement with fixed DT', () => {
  it('should move approximately (speed * 2 seconds) over 120 fixed steps (2 seconds total)', () => {
    const initialPosition = new THREE.Vector3(0, 1.8, 0); // Standard eye height on ground y=0
    let currentPosition = initialPosition.clone();
    let currentYVelocity = 0;
    const cameraYaw = 0; // Facing along -Z axis initially
    const keys = { 'KeyW': true }; // Moving forward
    const numSteps = 120;
    const expectedDisplacementZ = -PLAYER_SPEED_GROUND * (numSteps * FIXED_DT_S);

    for (let i = 0; i < numSteps; i++) {
      const inputState: PlayerMovementInputState = {
        currentPosition: currentPosition.clone(), // Pass a new clone each time
        currentYVelocity: currentYVelocity,
        currentIsFlying: false,
        cameraYaw: cameraYaw,
        keys: keys,
        chunkManager: mockChunkManager,
      };

      const outputState = calculatePlayerMovement(inputState);
      currentPosition = outputState.newPosition;
      currentYVelocity = outputState.newYVelocity;
    }

    // Check Z displacement
    // Player moves along -Z when KeyW is pressed and yaw is 0.
    expect(currentPosition.z).toBeCloseTo(initialPosition.z + expectedDisplacementZ, 1); // Allow some precision tolerance

    // Check X and Y position (should be minimal change for this specific test)
    expect(currentPosition.x).toBeCloseTo(initialPosition.x, 1);
    // Y position should remain stable around eye height if ground is flat and no jumping
    // It might vary slightly due to gravity and ground collision logic, so use a wider tolerance or check against expected ground contact.
    // For this test, getHeightAtPosition is mocked to 0, FPS_EYE_HEIGHT is not directly imported here but assumed in initial Y.
    // calculatePlayerMovement sets y to targetPlayerYOnGround when it collides.
    // FPS_EYE_HEIGHT is 1.6 in CameraSystem, initial position Y set to 1.8, so there might be a slight drop to 1.6
    expect(currentPosition.y).toBeCloseTo(1.6, 1); // Assuming FPS_EYE_HEIGHT is 1.6 and player settles there.
  });
}); 