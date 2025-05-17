import RAPIER from '@dimforge/rapier3d-compat';
import type { MatchState, Chunk as ServerChunk } from '../types';

/** 
 * Queues collider removals for a given chunk and clears its colliderHandles array.
 * Returns the number of colliders queued for removal.
 */
export function removeChunkColliders(
  world: RAPIER.World,
  state: MatchState,
  chunk: ServerChunk // Use ServerChunk to ensure colliderHandles is potentially there
): number {
  if (!chunk.colliderHandles || chunk.colliderHandles.length === 0) {
    return 0;
  }

  const handlesToRemove = [...chunk.colliderHandles]; // Copy handles before clearing
  let count = 0;

  for (const handle of handlesToRemove) {
    state.pendingColliders.push(() => {
      try {
        const collider = world.getCollider(handle);
        if (collider) { // Check if collider still exists before trying to remove
            // The second argument to removeCollider when passing a Collider object is 'wakeUp'
            world.removeCollider(collider, false); // Typically false if parent body management is separate or implicit
        } else {
            // console.warn(`[Physics/RemoveColliders] Attempted to remove already removed/invalid collider handle: ${handle} for chunk ${chunk.x},${chunk.z}`);
        }
      } catch (e) {
        console.error(`[Physics/RemoveColliders] Error removing collider handle ${handle} for chunk ${chunk.x},${chunk.z}:`, e);
      }
    });
    count++;
  }

  // console.log(`[Physics/RemoveColliders] Queued ${count} colliders for removal from chunk ${chunk.x},${chunk.z}`);
  chunk.colliderHandles = []; // Mark as detached immediately
  return count;
} 