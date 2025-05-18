import {
  BLOCK_AIR,
  BLOCK_DIRT,
  BLOCK_STONE,
  CHUNK_SIZE as SHARED_CHUNK_SIZE, // Alias to avoid conflict if local CHUNK_SIZE_X etc. are still used for some reason
  LOD_CHUNK_SIZE as SHARED_LOD_CHUNK_SIZE,
  LODLevel as SharedLODLevel
} from '../../shared/constants.js';
import { makeHeightFn } from './heightAt.js';

// Modified to be async and return a Promise
export async function genChunk(seed: number, cx: number, cz: number, lodLevel: number): Promise<{ voxels: Uint8Array, heightmap: Uint8Array, lastModified: number }> {
  return new Promise(resolve => {
    setImmediate(() => {
      const heightFn = makeHeightFn(seed, lodLevel);
      
      // Determine size and volume based on LOD level
      const currentSize = lodLevel === SharedLODLevel.LOW ? SHARED_LOD_CHUNK_SIZE : SHARED_CHUNK_SIZE;
      const currentVolume = currentSize.WIDTH * currentSize.HEIGHT * currentSize.DEPTH;
      const voxels = new Uint8Array(currentVolume);
      
      // Generate voxel data
      for (let lx = 0; lx < currentSize.WIDTH; lx++) {
        for (let lz = 0; lz < currentSize.DEPTH; lz++) {
          // World coordinate calculation for voxel placement
          // Scale factor for converting local LOD coordinates to equivalent world coordinates within the chunk
          const voxelPlacementScale = lodLevel === SharedLODLevel.LOW ? (SHARED_CHUNK_SIZE.WIDTH / SHARED_LOD_CHUNK_SIZE.WIDTH) : 1;
          const wx_voxel_base = cx * SHARED_CHUNK_SIZE.WIDTH + lx * voxelPlacementScale;
          const wz_voxel_base = cz * SHARED_CHUNK_SIZE.DEPTH + lz * voxelPlacementScale;

          // Get height at the *center* of this LOD voxel column for consistency
          const h_voxel_col = heightFn(wx_voxel_base + voxelPlacementScale / 2, wz_voxel_base + voxelPlacementScale / 2);

          for (let ly = 0; ly < currentSize.HEIGHT; ly++) {
            const idx = (ly * currentSize.WIDTH * currentSize.DEPTH) + (lz * currentSize.WIDTH) + lx;
            // Determine the world_y corresponding to the local_y in the current LOD's voxel grid
            const world_y = lodLevel === SharedLODLevel.LOW ? 
                            Math.floor(ly * (SHARED_CHUNK_SIZE.HEIGHT / SHARED_LOD_CHUNK_SIZE.HEIGHT)) :
                            ly;

            if (world_y > h_voxel_col) {
              voxels[idx] = BLOCK_AIR;
            } else if (world_y > h_voxel_col - 4) { 
              voxels[idx] = BLOCK_DIRT; 
            } else { 
              voxels[idx] = BLOCK_STONE;
            }
          }
        }
      }

      // Always generate a 32x32 heightmap for consistent interface, regardless of voxel LOD
      const outputHeightmap = new Uint8Array(SHARED_CHUNK_SIZE.WIDTH * SHARED_CHUNK_SIZE.DEPTH);
      for (let hx = 0; hx < SHARED_CHUNK_SIZE.WIDTH; hx++) {
        for (let hz = 0; hz < SHARED_CHUNK_SIZE.DEPTH; hz++) {
          // World coordinates for the high-resolution heightmap grid
          const wx_heightmap = cx * SHARED_CHUNK_SIZE.WIDTH + hx;
          const wz_heightmap = cz * SHARED_CHUNK_SIZE.DEPTH + hz;
          
          // Use the original heightFn (which is already LOD-aware for detail level)
          // For heightmap, we always want the detail level corresponding to the lodLevel param passed to genChunk.
          const h_val = heightFn(wx_heightmap, wz_heightmap);
          outputHeightmap[hz * SHARED_CHUNK_SIZE.WIDTH + hx] = h_val;
        }
      }

      resolve({ voxels, heightmap: outputHeightmap, lastModified: Date.now() });
    });
  });
} 