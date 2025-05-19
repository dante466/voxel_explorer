import {
  BLOCK_AIR,
  // BLOCK_DIRT, // Will come from biome
  // BLOCK_GRASS, // Will come from biome
  CHUNK_SIZE as SHARED_CHUNK_SIZE,
  LOD_CHUNK_SIZE as SHARED_LOD_CHUNK_SIZE,
  LODLevel as SharedLODLevel
} from '../../shared/constants.js';
import { makeHeightFn } from './heightAt.js';
import type { HeightInfo } from './heightAt.js';
import { BiomeId, Biomes, PlainsBiome } from './biomeTypes.js';
import type { BiomeDefinition } from './biomeTypes.js';
// import { makeNoise3D } from 'fast-simplex-noise'; // No longer needed as caves are removed

// Constants for cave generation - REMOVED
// const CAVE_THRESHOLD = 0.65; 
// const CAVE_NOISE_FREQUENCY = 0.05;

// Modified to be async and return a Promise
export async function genChunk(seed: number, cx: number, cz: number, lodLevel: number): Promise<{ voxels: Uint8Array, heightmap: Uint8Array, lastModified: number }> {
  return new Promise(resolve => {
    setImmediate(() => {
      const heightFn = makeHeightFn(seed, lodLevel);
      // const noise3D = makeNoise3D(() => seed); // No longer needed
      
      // Determine size and volume based on LOD level
      const currentSize = lodLevel === SharedLODLevel.LOW ? SHARED_LOD_CHUNK_SIZE : SHARED_CHUNK_SIZE;
      const currentVolume = currentSize.WIDTH * currentSize.HEIGHT * currentSize.DEPTH;
      const voxels = new Uint8Array(currentVolume); // Initialized to 0s (BLOCK_AIR by default)
      
      // --- Start of Modified Voxel Generation Logic ---
      // REMOVED: voxels.fill(BLOCK_DIRT);

      // Generate voxel data
      for (let lx = 0; lx < currentSize.WIDTH; lx++) {
        for (let lz = 0; lz < currentSize.DEPTH; lz++) {
          // World coordinate calculation for voxel placement
          const voxelPlacementScale = lodLevel === SharedLODLevel.LOW ? (SHARED_CHUNK_SIZE.WIDTH / SHARED_LOD_CHUNK_SIZE.WIDTH) : 1;
          const wx_voxel_base = cx * SHARED_CHUNK_SIZE.WIDTH + lx * voxelPlacementScale;
          const wz_voxel_base = cz * SHARED_CHUNK_SIZE.DEPTH + lz * voxelPlacementScale;

          // Get height and biome at the center of the current voxel column
          const { height: h_voxel_col, biomeId: currentBiomeId }: HeightInfo = heightFn(wx_voxel_base + voxelPlacementScale / 2, wz_voxel_base + voxelPlacementScale / 2);
          const biome: BiomeDefinition = Biomes.get(currentBiomeId) || PlainsBiome; // Fallback to Plains

          for (let ly = 0; ly < currentSize.HEIGHT; ly++) {
            const idx = (ly * currentSize.WIDTH * currentSize.DEPTH) + (lz * currentSize.WIDTH) + lx;
            const world_y = lodLevel === SharedLODLevel.LOW ? 
                            Math.floor(ly * (SHARED_CHUNK_SIZE.HEIGHT / SHARED_LOD_CHUNK_SIZE.HEIGHT)) :
                            ly;
            
            if (world_y < h_voxel_col) {
              voxels[idx] = biome.subSurfaceBlock;
            } else if (world_y === h_voxel_col) {
              voxels[idx] = biome.surfaceBlock;
            } else {
              voxels[idx] = BLOCK_AIR;  // Above surface: AIR (already 0, but explicit)
            }
          }
        }
      }
      // --- End of Modified Voxel Generation Logic ---

      // Always generate a 32x32 heightmap for consistent interface, regardless of voxel LOD
      const outputHeightmap = new Uint8Array(SHARED_CHUNK_SIZE.WIDTH * SHARED_CHUNK_SIZE.DEPTH);
      for (let hx = 0; hx < SHARED_CHUNK_SIZE.WIDTH; hx++) {
        for (let hz = 0; hz < SHARED_CHUNK_SIZE.DEPTH; hz++) {
          // World coordinates for the high-resolution heightmap grid
          const wx_heightmap = cx * SHARED_CHUNK_SIZE.WIDTH + hx;
          const wz_heightmap = cz * SHARED_CHUNK_SIZE.DEPTH + hz;
          
          // Use the original heightFn (which is already LOD-aware for detail level)
          // For heightmap, we always want the detail level corresponding to the lodLevel param passed to genChunk.
          const { height: h_val }: HeightInfo = heightFn(wx_heightmap, wz_heightmap);
          outputHeightmap[hz * SHARED_CHUNK_SIZE.WIDTH + hx] = h_val;
        }
      }

      resolve({ voxels, heightmap: outputHeightmap, lastModified: Date.now() });
    });
  });
} 