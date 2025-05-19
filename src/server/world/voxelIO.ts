import type { MatchState as IServerMatchState, Chunk } from '../types.js';
import { getOrCreateChunk } from './getOrCreateChunk.js';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from '../../shared/constants.js';

// DEFAULT_WORLD_SEED is no longer needed here as seed is passed in.

// Helper function to get a block from server's chunk data
export async function getBlock(state: IServerMatchState, seed: number, wx: number, wy: number, wz: number): Promise<number> {
  // Validate world Y coordinate first
  if (wy < 0 || wy >= CHUNK_SIZE_Y) return 0; // Return air for out-of-bounds Y

  const cx = Math.floor(wx / CHUNK_SIZE_X);
  const cz = Math.floor(wz / CHUNK_SIZE_Z);

  const chunk = await getOrCreateChunk(state, seed, cx, cz, 0); // LODLevel.HIGH is 0

  // Calculate local coordinates within the chunk
  const lx = ((wx % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
  const lz = ((wz % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
  // wy is already the local Y if CHUNK_SIZE_Y is max world height for a column

  const idx = wy * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;

  if (idx < 0 || idx >= chunk.data.length) {
    console.error(`Calculated index ${idx} is out of bounds for chunk ${cx},${cz} data length ${chunk.data.length} during getBlock`);
    return 0; // Should not happen if coordinates and chunk dimensions are correct
  }
  return chunk.data[idx]; // The brief implies chunk.voxels, but our Chunk type has .data
}

// Helper function to set a block in server's chunk data
export async function setBlock(state: IServerMatchState, seed: number, wx: number, wy: number, wz: number, id: number): Promise<Chunk | null> {
  // Validate world Y coordinate first
  if (wy < 0 || wy >= CHUNK_SIZE_Y) {
    console.warn(`[Srv SetBlock] Attempted to set block at invalid Y: ${wy}`);
    return null; // Return null if out-of-bounds Y
  }

  const cx = Math.floor(wx / CHUNK_SIZE_X);
  const cz = Math.floor(wz / CHUNK_SIZE_Z);
  const key = `${cx},${cz},L0`; // LODLevel.HIGH is 0

  // Get the chunk, potentially loading/generating it if not already in memory
  let chunk = state.chunks.get(key);
  if (!chunk) {
    try {
      chunk = await getOrCreateChunk(state, seed, cx, cz, 0); // LODLevel.HIGH is 0
    } catch (error) {
      console.error(`[Srv SetBlock] Error getting or creating chunk ${key}:`, error);
      return null;
    }
  }
  
  if (!chunk) { // Safeguard if getOrCreateChunk somehow returns null without erroring
    console.error(`[Srv SetBlock] Chunk ${key} still not found after getOrCreateChunk.`);
    return null;
  }
  
  if (!chunk.data) {
    console.error(`[Srv SetBlock] Chunk ${key} found but has no data array.`);
    return null;
  }

  // Calculate local coordinates within the chunk
  const lx = ((wx % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
  const lz = ((wz % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
  // wy is local Y

  const idx = wy * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;

  if (idx < 0 || idx >= chunk.data.length) {
    console.error(`Calculated index ${idx} is out of bounds for chunk ${cx},${cz} data length ${chunk.data.length} during setBlock. LX:${lx} LY:${wy} LZ:${lz}`);
    return null; // Return null if index is invalid
  }

  chunk.data[idx] = id; 
  chunk.isModified = true; // ADDED
  chunk.lastModified = Date.now();
  
  return chunk; // Return THE MODIFIED CHUNK on successful set
} 