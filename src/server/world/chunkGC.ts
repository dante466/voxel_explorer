// import { removeChunkColliders } from '../physics/removeChunkColliders.js'; // No longer used here
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../../shared/constants.js';
import type { MatchState, PlayerServer as Player, Chunk as ServerChunk } from '../types.js';
import type RAPIER from '@dimforge/rapier3d-compat';

const GC_RADIUS = 500; // metres. Chunks outside this radius from ALL players may be GC'd.
const GC_RADIUS_SQUARED = GC_RADIUS * GC_RADIUS;

/**
 * Identifies inactive chunks, removes them from state, and queues their collider handles for controlled removal.
 */
export function sweepInactiveChunks(
  _world: RAPIER.World, // Rapier world is no longer directly used here for removal
  state: MatchState,
): {
  removedChunkCount: number;
  colliderHandlesQueuedForRemoval: number;
} {
  const chunksToDelete: { key: string, chunk: ServerChunk }[] = [];
  let handlesCount = 0;

  if (state.players.size === 0) {
    for (const [key, chunk] of state.chunks) {
      chunksToDelete.push({ key, chunk });
    }
  } else {
    outerChunkLoop: for (const [key, chunk] of state.chunks) {
      const [cxStr, czStr] = key.split(','); // Assumes key format cx,cz,LOD
      const cx = parseInt(cxStr, 10);
      const cz = parseInt(czStr, 10);
      const chunkWorldX = (cx + 0.5) * CHUNK_SIZE_X;
      const chunkWorldZ = (cz + 0.5) * CHUNK_SIZE_Z;

      for (const player of state.players.values()) {
        if (player.bodyHandle === undefined) continue;
        const playerBody = state.physicsWorld?.raw.getRigidBody(player.bodyHandle);
        if (!playerBody) continue;
        const playerPosition = playerBody.translation();
        const dx = playerPosition.x - chunkWorldX;
        const dz = playerPosition.z - chunkWorldZ;
        if ((dx * dx + dz * dz) < GC_RADIUS_SQUARED) {
          continue outerChunkLoop;
        }
      }
      chunksToDelete.push({ key, chunk });
    }
  }

  let actualDeletedChunkCount = 0;
  if (!state.handlesPendingRemoval) {
    state.handlesPendingRemoval = []; // Ensure queue exists
  }

  for (const { key, chunk } of chunksToDelete) {
    if (chunk.colliderHandles && chunk.colliderHandles.length > 0) {
      state.handlesPendingRemoval.push(...chunk.colliderHandles);
      handlesCount += chunk.colliderHandles.length;
      chunk.colliderHandles = []; // Clear handles on the chunk object
    }
    if (state.chunks.delete(key)) {
      actualDeletedChunkCount++;
    }
  }

  if (actualDeletedChunkCount > 0) {
    console.log(`[ChunkGC] Deleted ${actualDeletedChunkCount} chunks. Queued ${handlesCount} collider handles for removal. Current pending removal queue size: ${state.handlesPendingRemoval.length}. Active chunks: ${state.chunks.size}`);
  }

  return {
    removedChunkCount: actualDeletedChunkCount,
    colliderHandlesQueuedForRemoval: handlesCount,
  };
} 