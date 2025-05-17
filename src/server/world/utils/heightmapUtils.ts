import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, AREA, BLOCK_AIR } from '../../../shared/constants';

/**
 * Calculates a heightmap for a given chunk's voxel data.
 * The height is defined as the y-level of the highest non-air block in each (x, z) column.
 * @param voxels The Uint8Array of voxel data for the chunk.
 * @returns A Uint8Array representing the heightmap, indexed by `x + z * CHUNK_SIZE_X`.
 */
export function calcHeightMap(voxels: Uint8Array): Uint8Array {
  if (voxels.length !== CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z) {
    throw new Error('Voxel array size does not match expected chunk dimensions.');
  }

  const heightMap = new Uint8Array(AREA);

  for (let x = 0; x < CHUNK_SIZE_X; x++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      let columnHeight = 0; // Default to 0 if all air
      for (let y = CHUNK_SIZE_Y - 1; y >= 0; y--) {
        const idx = (y * AREA) + (z * CHUNK_SIZE_X) + x;
        if (voxels[idx] !== BLOCK_AIR) {
          columnHeight = y;
          break;
        }
      }
      heightMap[x + z * CHUNK_SIZE_X] = columnHeight;
    }
  }
  return heightMap;
} 