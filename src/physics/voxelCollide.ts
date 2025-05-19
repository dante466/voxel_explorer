import * as THREE from 'three';
import { type ChunkManager } from '../world/ChunkManager';
import { Chunk } from '../world/Chunk';
import { CHUNK_SIZE } from '../shared/constants.js';

// Player AABB dimensions (can be moved to a shared constants file later)
export const PLAYER_COLLISION_WIDTH = 0.6; // meters
export const PLAYER_COLLISION_HEIGHT = 1.8; // meters
export const PLAYER_COLLISION_DEPTH = 0.6; // meters // Kept for now, though capsule is cylindrical

// Half extents for easier calculations
const HALF_WIDTH = PLAYER_COLLISION_WIDTH / 2; // Capsule radius
const HALF_HEIGHT = PLAYER_COLLISION_HEIGHT / 2;
// const HALF_DEPTH = PLAYER_COLLISION_DEPTH / 2; // Less relevant for capsule

// Epsilon for floating point comparisons and slight offsets
const COLLISION_EPSILON = 0.001;

/**
 * Resolves player collision against voxel world using a capsule-like approach.
 * Prioritizes vertical adjustment based on a heightfield query, then horizontal.
 * Based on Triage Kit 2-A.
 *
 * @param proposedCenterPos The proposed center position of the capsule.
 * @param chunkManager To query voxel data.
 * @param autoStepEnabled Flag to enable or disable auto-step vertical adjustment
 * @returns The corrected center position.
 */
export function resolveAABBvoxelCollision(
    proposedCenterPos: THREE.Vector3,
    chunkManager: ChunkManager,
    autoStepEnabled: boolean
): THREE.Vector3 {
    const correctedPos = proposedCenterPos.clone();
    const capsuleRadius = HALF_WIDTH;
    const capsuleBottomY = proposedCenterPos.y - HALF_HEIGHT;
    const capsuleTopY = proposedCenterPos.y + HALF_HEIGHT;

    // --- Vertical Adjustment (Triage Kit 2-A: "Slide the capsule up") ---
    let maxGroundSurfaceY = -Infinity;
    const checkRadius = Math.ceil(capsuleRadius); // Check voxels within this integer radius

    // Query 3x3 or wider area for ground support
    // The Triage Kit mentions "3x3 voxel area under the capsule"
    // We'll check a 3x3 grid of voxel columns centered on the player's XZ.
    const floorPlayerX = Math.floor(correctedPos.x);
    const floorPlayerZ = Math.floor(correctedPos.z);

    for (let dx = -1; dx <= 1; dx++) { // Check 3x3 columns
        for (let dz = -1; dz <= 1; dz++) {
            const voxelX = floorPlayerX + dx;
            const voxelZ = floorPlayerZ + dz;

            // Find highest solid block in this column up to player's capsule bottom
            // This is a simplified height query. A true heightmap from ChunkManager might be better if available.
            // For now, iterate down from capsule bottom.
            for (let scanY = Math.floor(capsuleBottomY + 1); scanY >= 0; scanY--) {
                 // Simplified getBlock - direct to chunkManager is better
                const blockId = getBlockIdAtWorldPos(chunkManager, voxelX, scanY, voxelZ);
                if (blockId > 0) { // If solid
                    const blockSurfaceY = scanY + 1;
                    if (blockSurfaceY > maxGroundSurfaceY) {
                        maxGroundSurfaceY = blockSurfaceY;
                    }
                    break; // Found highest solid in this column
                }
            }
        }
    }
    
    // If player's capsule bottom is below the highest found ground surface, adjust Y
    if (autoStepEnabled) {
      if (maxGroundSurfaceY > -Infinity && capsuleBottomY < maxGroundSurfaceY) {
          correctedPos.y = maxGroundSurfaceY + HALF_HEIGHT; 
          // console.log(`[VoxelCollide] Vertical Adjust (AutoStep ON): ProposedBottomY: ${capsuleBottomY.toFixed(2)}, MaxGroundY: ${maxGroundSurfaceY.toFixed(2)}, CorrectedCenterY: ${correctedPos.y.toFixed(2)}`);
      }
    } else {
      // Optional: Log when auto-step is off and this vertical adjustment would have occurred
      // if (maxGroundSurfaceY > -Infinity && capsuleBottomY < maxGroundSurfaceY) {
      //    console.log(`[VoxelCollide] Vertical Adjust (AutoStep OFF): Would have snapped. ProposedBottomY: ${capsuleBottomY.toFixed(2)}, MaxGroundY: ${maxGroundSurfaceY.toFixed(2)}`);
      // }
    }
    
    // --- Horizontal Adjustment (Simplified AABB-style push-out for now) ---
    // After vertical adjustment, define the new AABB based on correctedPos.y
    const playerAABB = new THREE.Box3(
        new THREE.Vector3(
            correctedPos.x - capsuleRadius, // Use capsuleRadius for XZ
            correctedPos.y - HALF_HEIGHT,
            correctedPos.z - capsuleRadius  // Use capsuleRadius for XZ
        ),
        new THREE.Vector3(
            correctedPos.x + capsuleRadius,
            correctedPos.y + HALF_HEIGHT,
            correctedPos.z + capsuleRadius
        )
    );

    const minVX = Math.floor(playerAABB.min.x);
    const maxVX = Math.floor(playerAABB.max.x);
    const minVY = Math.floor(playerAABB.min.y); // Iterate through player height
    const maxVY = Math.floor(playerAABB.max.y);
    const minVZ = Math.floor(playerAABB.min.z);
    const maxVZ = Math.floor(playerAABB.max.z);

    for (let iter = 0; iter < 3; iter++) { // Iterative resolution for horizontal
        let collisionOccurred = false;
        for (let vx = minVX; vx <= maxVX; vx++) {
            for (let vy = minVY; vy <= maxVY; vy++) {
                for (let vz = minVZ; vz <= maxVZ; vz++) {
                    const blockId = getBlockIdAtWorldPos(chunkManager, vx, vy, vz);

                    if (blockId > 0) { // Solid voxel
                        const voxelAABB = new THREE.Box3(
                            new THREE.Vector3(vx, vy, vz),
                            new THREE.Vector3(vx + 1, vy + 1, vz + 1)
                        );

                        if (playerAABB.intersectsBox(voxelAABB)) {
                            collisionOccurred = true;
                            // Calculate penetration depth on each axis for horizontal push-out
                            const penX = Math.min(playerAABB.max.x - voxelAABB.min.x, voxelAABB.max.x - playerAABB.min.x);
                            const penZ = Math.min(playerAABB.max.z - voxelAABB.min.z, voxelAABB.max.z - playerAABB.min.z);

                            // We only resolve X or Z here, Y was handled by ground snapping.
                            // This is a simplified horizontal resolution.
                            if (penX < penZ) {
                                if ((correctedPos.x - vx) > 0.5) { // Player is to the right of voxel center
                                    correctedPos.x = voxelAABB.max.x + capsuleRadius + COLLISION_EPSILON;
                                } else {
                                    correctedPos.x = voxelAABB.min.x - capsuleRadius - COLLISION_EPSILON;
                                }
                            } else {
                                if ((correctedPos.z - vz) > 0.5) { // Player is "in front" (larger Z) of voxel center
                                    correctedPos.z = voxelAABB.max.z + capsuleRadius + COLLISION_EPSILON;
                                } else {
                                    correctedPos.z = voxelAABB.min.z - capsuleRadius - COLLISION_EPSILON;
                                }
                            }
                            // Update playerAABB for the next check within this iteration
                            playerAABB.set(
                                new THREE.Vector3(correctedPos.x - capsuleRadius, correctedPos.y - HALF_HEIGHT, correctedPos.z - capsuleRadius),
                                new THREE.Vector3(correctedPos.x + capsuleRadius, correctedPos.y + HALF_HEIGHT, correctedPos.z + capsuleRadius)
                            );
                        }
                    }
                }
            }
        }
        if (!collisionOccurred) break; // No collisions in this iteration, stable
    }
    return correctedPos;
}


/**
 * Helper to get block ID from ChunkManager at world coordinates.
 */
function getBlockIdAtWorldPos(chunkManager: ChunkManager, worldX: number, worldY: number, worldZ: number): number {
    if (worldY < 0 || worldY >= CHUNK_SIZE.HEIGHT) {
        return 0; // Outside buildable height, treat as air
    }

    const chunkCX = Math.floor(worldX / CHUNK_SIZE.WIDTH);
    const chunkCZ = Math.floor(worldZ / CHUNK_SIZE.DEPTH);
    
    const chunk = chunkManager.getChunkData(`${chunkCX},${chunkCZ}`);
    if (!chunk) {
        // If chunk doesn't exist, can treat as solid (conservative) or air (permissive).
        // For client-side prediction, air might be better to avoid getting stuck.
        return 0; 
    }

    const localX = ((worldX % CHUNK_SIZE.WIDTH) + CHUNK_SIZE.WIDTH) % CHUNK_SIZE.WIDTH;
    const localZ = ((worldZ % CHUNK_SIZE.DEPTH) + CHUNK_SIZE.DEPTH) % CHUNK_SIZE.DEPTH;
    // worldY is already absolute and assumed to be within chunk's vertical bounds by this point (or clamped by getVoxel)
    
    return chunk.getVoxel(localX, worldY, localZ);
}

// Client-side equivalent of getBlock, needs to be implemented or use ChunkManager methods
// function getBlockClient(x: number, y: number, z: number, chunkManager: ChunkManager): number {
//    return chunkManager.getBlockData(x, y, z); // Example, depends on ChunkManager API
// }

// TODO: Unit test for this helper.
// - Mock ChunkManager
// - Test case: proposedPos is inside a solid block -> correctedPos is just outside.
// - Test case: proposedPos is clear -> correctedPos is same as proposedPos.
// - Test case: proposedPos is partially intersecting -> correctedPos is pushed out. 