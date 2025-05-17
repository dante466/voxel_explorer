import type { MatchState as IServerMatchState } from '../types.js';
import { getOrCreateChunk } from './getOrCreateChunk.js';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from '../../shared/constants.js';

// DEFAULT_WORLD_SEED is no longer needed here as seed is passed in.

// Helper function to get a block from server's chunk data
export async function getBlock(state: IServerMatchState, seed: number, wx: number, wy: number, wz: number): Promise<number> {
  // Validate world Y coordinate first
  if (wy < 0 || wy >= CHUNK_SIZE_Y) return 0; // Return air for out-of-bounds Y

  const cx = Math.floor(wx / CHUNK_SIZE_X);
  const cz = Math.floor(wz / CHUNK_SIZE_Z);

  const chunk = await getOrCreateChunk(state, seed, cx, cz);

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
export async function setBlock(state: IServerMatchState, seed: number, wx: number, wy: number, wz: number, id: number): Promise<boolean> {
  if (wy < 0 || wy >= CHUNK_SIZE_Y) return false; // Return false if out-of-bounds Y

  const cx = Math.floor(wx / CHUNK_SIZE_X);
  const cz = Math.floor(wz / CHUNK_SIZE_Z);

  const chunk = await getOrCreateChunk(state, seed, cx, cz);
  // If getOrCreateChunk itself could fail and return null/undefined, we'd check here.
  // Assuming it always returns a valid Chunk or throws (which would be caught by a higher level).

  // Calculate local coordinates within the chunk
  const lx = ((wx % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
  const lz = ((wz % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
  // wy is local Y

  const idx = wy * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;

  if (idx < 0 || idx >= chunk.data.length) {
    console.error(`Calculated index ${idx} is out of bounds for chunk ${cx},${cz} data length ${chunk.data.length} during setBlock`);
    return false; // Return false if index is invalid
  }

  chunk.data[idx] = id; // Brief implies chunk.voxels, using .data from Chunk type
  chunk.lastModified = Date.now();
  return true; // Return true on successful set
} 