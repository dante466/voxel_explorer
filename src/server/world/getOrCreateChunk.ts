import { genChunk } from './genChunk.js';
import { chunkKey } from './chunkUtils.js';
import type { MatchState, Chunk } from '../types.js'; // Assuming Chunk type is compatible or genChunk returns it

export function getOrCreateChunk(
  state: MatchState,
  seed: number,
  cx: number,
  cz: number
): Chunk {
  const key = chunkKey(cx, cz);
  let chunk = state.chunks.get(key);

  if (!chunk) {
    // The genChunk function in this project returns { voxels: Uint8Array, lastModified: number }
    // The Chunk type in types.ts is { x: number, z: number, data: Uint8Array, lastModified: number }
    // We need to construct the Chunk object correctly.
    const generatedChunkData = genChunk(seed, cx, cz);
    
    chunk = {
        x: cx,
        z: cz,
        data: generatedChunkData.voxels,
        lastModified: generatedChunkData.lastModified
    };
    state.chunks.set(key, chunk);
    console.log(`[Server] S1-3 (getOrCreateChunk): Generated and cached chunk ${key}.`);
    // NOTE: terrain colliders will be attached later in S2-2
  }

  return chunk;
} 