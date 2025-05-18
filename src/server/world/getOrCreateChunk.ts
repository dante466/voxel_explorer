import type { MatchState, Chunk } from '../types.js';
// buildChunkColliders is no longer called here directly
// genChunk is no longer directly called here, it's called by the queue

export async function getOrCreateChunk(
  state: MatchState,
  seed: number,
  cx: number,
  cz: number,
  lodLevel: number
): Promise<Chunk> {
  const key = `${cx},${cz},L${lodLevel}`;
  // console.log(`[Srv GetOrCreate ${key}] Called.`);
  let chunk = state.chunks.get(key);

  if (!chunk) {
    // console.log(`[Server GOC] Chunk ${key} not in cache. Enqueuing generation.`);
    // The queue now handles Chunk object creation, collider building, and adding to state.chunks.
    // It returns the fully processed Chunk object.
    try {
      chunk = await state.chunkGenQueue.enqueue(state, seed, cx, cz, lodLevel);
      // console.log(`[Srv GetOrCreate ${key}] Received chunk from queue. Collider handles: ${chunk?.colliderHandles?.length}`);
      if (!chunk) { // Should not happen if enqueue resolves, but as a safeguard
        console.error(`[Server GOC] ChunkGenerationQueue.enqueue returned undefined for ${key}`);
        throw new Error(`ChunkGenerationQueue.enqueue returned undefined for ${key}`);
      }
    } catch (error) {
      console.error(`[Server GOC] Error during chunk generation queue processing for ${key}:`, error);
      // Re-throw the error so the caller (e.g., handleMessage for chunkRequest) can handle it.
      // This might involve sending an error response to the client.
      throw error; 
    }
  } else {
    // console.log(`[Srv GetOrCreate ${key}] Cache HIT.`);
  }

  return chunk; // chunk is now guaranteed to be a Chunk if no error was thrown
} 