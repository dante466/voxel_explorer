// Mock for src/world/noiseWorker.ts for testing purposes.
// This should implement the *server's* target generation algorithm to ensure consistency testing.

import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, BLOCK_AIR, BLOCK_DIRT, BLOCK_STONE, AREA } from '../shared/constants';
// import { makeNoise2D } from 'fast-simplex-noise'; // No longer needed for flat map
// import alea from 'alea'; // No longer needed for flat map

const FLAT_GROUND_HEIGHT = 30; // Define a constant height for the flat terrain (must match server's genChunk)

// This function replicates the logic from src/server/world/genChunk.ts (now for flat map)
export function generateClientChunk(seed: number, chunkX: number, chunkZ: number): { voxels: Uint8Array; lastModified: number } {
  // Seed, chunkX, chunkZ are no longer used for generation logic but kept for signature consistency
  const voxels = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);

  for (let x = 0; x < CHUNK_SIZE_X; x++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      const height = FLAT_GROUND_HEIGHT;

      for (let y = 0; y < CHUNK_SIZE_Y; y++) {
        const idx = (y * AREA) + (z * CHUNK_SIZE_X) + x;
        if (y > height) {
          voxels[idx] = BLOCK_AIR;
        } else if (y > height - 4 && y <= height) { // Top 3 layers (height, height-1, height-2, height-3) up to specified height are DIRT
          voxels[idx] = BLOCK_DIRT;
        } else { // Below dirt layer is STONE
          voxels[idx] = BLOCK_STONE;
        }
      }
    }
  }

  return { voxels, lastModified: Date.now() }; // lastModified is for consistency with genChunk signature
} 