import RAPIER from '@dimforge/rapier3d-compat';
import type { MatchState, Chunk as ServerChunk } from '../types';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from '../../shared/constants';

/** 
 * Queues all existing collider handles from a chunk for removal and clears the chunk's handle store.
 * This is typically used during chunk garbage collection.
 * Returns the number of handles queued for removal.
 */
export function removeChunkColliders(
  _world: RAPIER.World, // World parameter is no longer strictly needed here as we just collect handles
  state: MatchState,
  chunk: ServerChunk 
): number {
  if (!chunk.colliderHandles) {
    // console.log(`[Physics/RemoveColliders GC] Chunk ${chunk.x},${chunk.z} has no colliderHandles array. Nothing to remove.`);
    return 0;
  }

  let handlesQueued = 0;

  if (!state.handlesPendingRemoval) {
    state.handlesPendingRemoval = [];
  }

  // Iterate over the 1D array of collider handles
  for (const handle of chunk.colliderHandles) {
    if (typeof handle === 'number') {
      state.handlesPendingRemoval.push(handle);
      handlesQueued++;
    }
  }

  if (handlesQueued > 0) {
    // console.log(`[Physics/RemoveColliders GC] Queued ${handlesQueued} collider handles for removal from chunk ${chunk.x},${chunk.z}`);
  }
  
  // Clear the handles on the chunk object by setting it to an empty array.
  chunk.colliderHandles = []; 

  return handlesQueued;
} 