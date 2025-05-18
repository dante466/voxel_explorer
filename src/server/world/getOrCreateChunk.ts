import { genChunk } from './genChunk.js';
import { chunkKey } from './chunkUtils.js';
import type { MatchState, Chunk } from '../types.js'; // Assuming Chunk type is compatible or genChunk returns it
import { buildChunkColliders } from '../physics/buildChunkColliders.js';

export async function getOrCreateChunk(
  state: MatchState,
  seed: number,
  cx: number,
  cz: number
): Promise<Chunk> {
  const key = chunkKey(cx, cz);
  let chunk = state.chunks.get(key);

  if (!chunk) {
    // The genChunk function in this project returns { voxels: Uint8Array, lastModified: number }
    // The Chunk type in types.ts is { x: number, z: number, data: Uint8Array, lastModified: number }
    // We need to construct the Chunk object correctly.
    const generatedChunkData = genChunk(seed, cx, cz);
    
    // Create the chunk object first, so it can be passed to buildChunkColliders
    chunk = {
        x: cx,
        z: cz,
        data: generatedChunkData.voxels,
        heightmap: generatedChunkData.heightmap,
        lastModified: generatedChunkData.lastModified,
        colliderHandles: [], // Initialize as empty, will be populated by queued closures
    };

    if (state.physicsWorld && state.physicsWorld.raw) {
      console.log(`[Physics/getOrCreateChunk] Calling buildChunkColliders to ENQUEUE colliders for new chunk ${key}...`);
      // buildChunkColliders is now synchronous and returns a count.
      // It needs the matchState and the chunk object itself.
      const enqueuedCount = buildChunkColliders(
        state.physicsWorld.raw, 
        chunk, // Pass the chunk object
        generatedChunkData.voxels, 
        cx, 
        cz, 
        state // Pass the matchState
      );
      console.log(`[Physics/getOrCreateChunk] ENQUEUED ${enqueuedCount} colliders for new chunk ${key}. Actual handles will be populated by the queue.`);
    } else {
      console.warn(`[Physics/getOrCreateChunk] physicsWorld or physicsWorld.raw not available for chunk ${key}. Colliders not enqueued.`);
    }
    
    state.chunks.set(key, chunk);
    // The log for chunk.colliderHandles?.length here will likely be 0 initially.
    console.log(`[Server/getOrCreateChunk] Generated and cached chunk ${key}. Colliders enqueued (handles will populate async).`);
    // NOTE: terrain colliders will be attached later in S2-2
  }

  return chunk;
} 