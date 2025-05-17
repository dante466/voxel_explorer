import RAPIER from '@dimforge/rapier3d-compat';
import {
  CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z,
  BLOCK_AIR
} from '../../shared/constants';
import type { MatchState, Chunk as ServerChunk } from '../types'; // Import MatchState and ServerChunk

/**
 * Enqueues functions to create column-based colliders for solid voxels in a chunk.
 * Returns the number of colliders enqueued.
 */
export function buildChunkColliders(
  world: RAPIER.World,
  chunkObject: ServerChunk, // The actual chunk instance to store handles
  voxels: Uint8Array,
  cx: number,
  cz: number,
  matchState: MatchState
): number {
  let collidersEnqueued = 0;
  const area = CHUNK_SIZE_X * CHUNK_SIZE_Z;
  const halfBlock = 0.5;

  // console.log(`[Physics/BuildColliders] Queuing column colliders for chunk ${cx},${cz}`);

  for (let x = 0; x < CHUNK_SIZE_X; x++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      let columnTopY = -1;
      // Find the highest solid block in this (x,z) column
      for (let y = CHUNK_SIZE_Y - 1; y >= 0; y--) {
        const idx = y * area + z * CHUNK_SIZE_X + x;
        if (voxels[idx] !== BLOCK_AIR) {
          columnTopY = y;
          break;
        }
      }

      if (columnTopY !== -1) {
        // This column has at least one solid block
        const columnHeight = columnTopY + 1; // Number of blocks high
        const colliderHalfHeight = columnHeight / 2;
        const colliderCenterY = columnHeight / 2 - halfBlock; // Center of the bottom block is 0.5, so center of column is height/2 - 0.5
        // User example: colDesc.setHalfExtents(0.5, columnTop/2, 0.5); enqueueVoxel(wx, columnTop/2, wz);
        // Let's stick to user's simplified columnTop for y-extents and y-pos, assuming 'columnTop' implies a characteristic height for the collider.
        // If columnTopY is the highest index (0 to 127), then a 'height' based on that is columnTopY+1.
        // User's 'columnTop/2' seems to treat columnTopY as the height directly. Let's use (columnTopY + 1) for actual height.

        const actualColliderHalfHeight = (columnTopY + 1) / 2;
        const actualColliderCenterY = (columnTopY + 1) / 2 - halfBlock; // Center relative to world origin if blocks start at y=0

        const wx = cx * CHUNK_SIZE_X + x + halfBlock;
        const wy = actualColliderCenterY; // This needs to be world y.
                                       // If y=0 is base of world, then this is fine.
        const wz = cz * CHUNK_SIZE_Z + z + halfBlock;

        const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
        // Note: setTranslation will be done in the closure, allowing it to be dynamic if needed, though here it's fixed.
        const colliderDesc = RAPIER.ColliderDesc.cuboid(halfBlock, actualColliderHalfHeight, halfBlock);

        matchState.pendingColliders.push(() => {
          try {
            const body = world.createRigidBody(rigidBodyDesc.setTranslation(wx, wy, wz));
            const collider = world.createCollider(colliderDesc, body);
            if (!chunkObject.colliderHandles) {
              chunkObject.colliderHandles = [];
            }
            chunkObject.colliderHandles.push(collider.handle);
          } catch (e) {
            console.error(`[Physics/ColliderQueue] Error creating column collider for chunk ${cx},${cz} at col (${x},${z}):`, e);
          }
        });
        collidersEnqueued++;
      }
    }
  }

  // console.log(`[Physics/BuildColliders] Queued ${collidersEnqueued} column colliders for chunk ${cx},${cz}`);
  return collidersEnqueued;
}

// Public wrapper and queue logic removed for S2-1, will be part of S2-2 integration.