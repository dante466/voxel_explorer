import {
  CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z,
  BLOCK_AIR, BLOCK_DIRT, BLOCK_STONE
} from '../../shared/constants.js';
import { makeHeightFn } from './heightAt.js';

export function genChunk(seed: number, cx: number, cz: number) {
  const heightFn = makeHeightFn(seed);
  const voxels = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);

  for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      const wx = cx * CHUNK_SIZE_X + lx;
      const wz = cz * CHUNK_SIZE_Z + lz;

      const h = heightFn(wx, wz);

      for (let y = 0; y < CHUNK_SIZE_Y; y++) {
        const idx = (y * CHUNK_SIZE_X * CHUNK_SIZE_Z) + (lz * CHUNK_SIZE_X) + lx;
        if (y > h) { // Above calculated height is air
          voxels[idx] = BLOCK_AIR;
        } else if (y > h - 4) { // Top 0-3 layers below or at h (e.g. h, h-1, h-2, h-3)
          voxels[idx] = BLOCK_DIRT; 
        } else { // Deeper layers
          voxels[idx] = BLOCK_STONE;
        }
      }
    }
  }

  return { voxels, lastModified: Date.now() };
} 