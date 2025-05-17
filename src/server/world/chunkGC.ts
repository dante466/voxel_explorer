import { removeChunkColliders } from '../physics/removeChunkColliders.js';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../../shared/constants.js';
import type { MatchState, Player, Chunk as ServerChunk } from '../types.js';
import type RAPIER from '@dimforge/rapier3d-compat';

const GC_RADIUS = 160; // metres. Chunks outside this radius from ALL players may be GC'd.
const GC_RADIUS_SQUARED = GC_RADIUS * GC_RADIUS;

/**
 * Sweeps through loaded chunks and queues colliders for removal if no player is nearby.
 * Also removes the chunk data from state.chunks.
 */
export function sweepInactiveChunks(
  world: RAPIER.World, // Rapier world for removeChunkColliders
  state: MatchState,
  // seed: number // Seed is not used in this function currently
): {
  removedChunkCount: number;
  removedColliderCount: number;
} {
  const chunksToDeleteKeys: string[] = [];
  let totalCollidersRemovedCount = 0;

  // console.log(`[ChunkGC] Starting sweep. Total chunks: ${state.chunks.size}. Players: ${state.players.size}`);

  if (state.players.size === 0) {
    // No players online, remove all chunks with colliders
    // console.log('[ChunkGC] No players online. Scheduling all loaded chunks for GC.');
    for (const [key, chunk] of state.chunks) {
      chunksToDeleteKeys.push(key);
      totalCollidersRemovedCount += removeChunkColliders(world, state, chunk);
    }
  } else {
    // Iterate over chunks to find those far from all players
    outerChunkLoop: for (const [key, chunk] of state.chunks) {
      const [cxStr, czStr] = key.split(',');
      const cx = parseInt(cxStr, 10);
      const cz = parseInt(czStr, 10);

      // Calculate chunk center world coordinates
      const chunkWorldX = (cx + 0.5) * CHUNK_SIZE_X;
      const chunkWorldZ = (cz + 0.5) * CHUNK_SIZE_Z;

      // Check against each player
      for (const player of state.players.values()) {
        // Using player.position (simple x,y,z from server state) for now as per discussion.
        // TODO: Replace with player.body.translation() when server-side player physics bodies are robust.
        const dx = player.position.x - chunkWorldX;
        const dz = player.position.z - chunkWorldZ;
        
        if ((dx * dx + dz * dz) < GC_RADIUS_SQUARED) {
          // This chunk is near at least one player, so keep it.
          continue outerChunkLoop; 
        }
      }

      // If we reach here, the chunk is not near any player.
      // console.log(`[ChunkGC] Chunk ${key} is far from all players. Scheduling for GC.`);
      chunksToDeleteKeys.push(key);
      totalCollidersRemovedCount += removeChunkColliders(world, state, chunk);
    }
  }

  let actualDeletedChunkCount = 0;
  for (const key of chunksToDeleteKeys) {
    if (state.chunks.delete(key)) {
      actualDeletedChunkCount++;
    }
  }

  if (actualDeletedChunkCount > 0) {
    console.log(`[ChunkGC] Removed ${totalCollidersRemovedCount} colliders from ${actualDeletedChunkCount} chunks. Pending queue: ${state.pendingColliders.length}. Active chunks: ${state.chunks.size}`);
  }

  return {
    removedChunkCount: actualDeletedChunkCount,
    removedColliderCount: totalCollidersRemovedCount,
  };
} 