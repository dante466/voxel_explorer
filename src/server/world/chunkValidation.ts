import { makeNoise2D } from 'fast-simplex-noise';
import {
  BASE_HEIGHT, SEA_LEVEL, MOUNTAIN_HEIGHT,
  NOISE_FREQ_1, NOISE_FREQ_2, NOISE_FREQ_3,
  NOISE_AMP_1, NOISE_AMP_2, NOISE_AMP_3
} from '../../shared/terrainConsts.js';
import { BiomeId, Biomes, BIOME_NOISE_FREQUENCY, BIOME_NOISE_AMPLITUDE, PlainsBiome, BIOME_TRANSITION_WIDTH } from './biomeTypes.js';
import type { BiomeDefinition, BiomeTerrainParameters } from './biomeTypes.js';

// Constants from client's src/world/Chunk.ts and src/world/noiseWorker.ts
// Assuming LODLevel.HIGH for comparison as per S1-1 typically focusing on primary detail.
const CHUNK_WIDTH = 32;
const CHUNK_HEIGHT = 128;
const CHUNK_DEPTH = 32;

// Simple mulberry32 PRNG - duplicated here for consistency in this validation file
function mulberry32(a: number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0; a = Math.imul(a ^ a >>> 15, 1 | a);
    a = a + Math.imul(a ^ a >>> 7, 61 | a) | 0;
    return ((a ^ a >>> 14) >>> 0) / 4294967296;
  }
}

// Helper function to interpolate between two BiomeTerrainParameters objects - DUPLICATED from heightAt.ts for validation
function interpolateTerrainParameters(
  baseParams: BiomeTerrainParameters,
  targetParams: BiomeTerrainParameters,
  alpha: number
): BiomeTerrainParameters {
  return {
    baseHeight:     baseParams.baseHeight * (1 - alpha) + targetParams.baseHeight * alpha,
    seaLevel:       baseParams.seaLevel * (1 - alpha) + targetParams.seaLevel * alpha,
    mountainHeight: baseParams.mountainHeight * (1 - alpha) + targetParams.mountainHeight * alpha,
    noiseFreq1:     baseParams.noiseFreq1 * (1 - alpha) + targetParams.noiseFreq1 * alpha,
    noiseAmp1:      baseParams.noiseAmp1 * (1 - alpha) + targetParams.noiseAmp1 * alpha,
    noiseFreq2:     baseParams.noiseFreq2 * (1 - alpha) + targetParams.noiseFreq2 * alpha,
    noiseAmp2:      baseParams.noiseAmp2 * (1 - alpha) + targetParams.noiseAmp2 * alpha,
    noiseFreq3:     baseParams.noiseFreq3 * (1 - alpha) + targetParams.noiseFreq3 * alpha,
    noiseAmp3:      baseParams.noiseAmp3 * (1 - alpha) + targetParams.noiseAmp3 * alpha,
  };
}

// Define biome boundaries - DUPLICATED from heightAt.ts for validation
const DESERT_PLAINS_BOUNDARY = -0.33;
const PLAINS_MOUNTAINS_BOUNDARY = 0.33;

/**
 * Replicates the client's heightmap generation logic from src/world/noiseWorker.ts
 * for a specific chunk using LODLevel.HIGH settings.
 * NOW UPDATED to match the "mommy engineer llm" specification, same as heightAt.ts.
 */
export function replicateClientHeightmapGen(seed: number, chunkX: number, chunkZ: number): Uint8Array {
  // Noise functions for terrain details
  const randomFunc1 = mulberry32(seed);
  const randomFunc2 = mulberry32(seed ^ 0xdeadbeef);
  const randomFunc3 = mulberry32(seed ^ 0x41c64e6d);

  const noiseFunc1 = makeNoise2D(randomFunc1);
  const noiseFunc2 = makeNoise2D(randomFunc2);
  const noiseFunc3 = makeNoise2D(randomFunc3);

  // Biome noise function
  const randomFuncBiome = mulberry32(seed ^ 0xabcdef01); // Seed for biome selection noise
  const noiseFuncBiome = makeNoise2D(randomFuncBiome); // Noise function for biome selection

  // const SUM_AMPS = NOISE_AMP_1 + NOISE_AMP_2 + NOISE_AMP_3; // This will now be dynamic based on biome params
  const heightmap = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH);

  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let z = 0; z < CHUNK_DEPTH; z++) {
      const worldXBase = chunkX * CHUNK_WIDTH + x;
      const worldZBase = chunkZ * CHUNK_DEPTH + z;

      // Sample at the center of the column, like genChunk.ts does for h_voxel_col
      // For heightmap generation in genChunk, it uses wx_heightmap, wz_heightmap directly, not offset by 0.5
      // Let's stick to direct coordinates for this replication to match genChunk's heightmap loop.
      const sampleX = worldXBase; // Updated: No +0.5 for direct heightmap replication
      const sampleZ = worldZBase; // Updated: No +0.5 for direct heightmap replication

      // --- Biome determination logic (mirrors heightAt.ts) ---
      const biomeVal = noiseFuncBiome(sampleX * BIOME_NOISE_FREQUENCY, sampleZ * BIOME_NOISE_FREQUENCY) * BIOME_NOISE_AMPLITUDE;

      let primaryBiomeDef: BiomeDefinition = PlainsBiome; // Fallback
      let finalParams: BiomeTerrainParameters;
      let calculatedAlpha = 0;

      if (biomeVal < DESERT_PLAINS_BOUNDARY) {
        primaryBiomeDef = Biomes.get(BiomeId.Desert) || PlainsBiome;
        const secondaryBiomeDef = Biomes.get(BiomeId.Plains) || PlainsBiome;
        if (biomeVal > DESERT_PLAINS_BOUNDARY - BIOME_TRANSITION_WIDTH) {
          calculatedAlpha = (biomeVal - (DESERT_PLAINS_BOUNDARY - BIOME_TRANSITION_WIDTH)) / BIOME_TRANSITION_WIDTH;
          finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
        } else {
          finalParams = primaryBiomeDef.terrainParameters;
        }
      } else if (biomeVal < PLAINS_MOUNTAINS_BOUNDARY) {
        primaryBiomeDef = Biomes.get(BiomeId.Plains) || PlainsBiome;
        if (biomeVal < DESERT_PLAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) {
          const secondaryBiomeDef = Biomes.get(BiomeId.Desert) || PlainsBiome;
          calculatedAlpha = ((DESERT_PLAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) - biomeVal) / BIOME_TRANSITION_WIDTH;
          finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
        } else if (biomeVal > PLAINS_MOUNTAINS_BOUNDARY - BIOME_TRANSITION_WIDTH) {
          const secondaryBiomeDef = Biomes.get(BiomeId.Mountains) || PlainsBiome;
          calculatedAlpha = (biomeVal - (PLAINS_MOUNTAINS_BOUNDARY - BIOME_TRANSITION_WIDTH)) / BIOME_TRANSITION_WIDTH;
          finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
        } else {
          finalParams = primaryBiomeDef.terrainParameters;
        }
      } else { // biomeVal >= PLAINS_MOUNTAINS_BOUNDARY
        primaryBiomeDef = Biomes.get(BiomeId.Mountains) || PlainsBiome;
        const secondaryBiomeDef = Biomes.get(BiomeId.Plains) || PlainsBiome;
        if (biomeVal < PLAINS_MOUNTAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) {
          calculatedAlpha = ((PLAINS_MOUNTAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) - biomeVal) / BIOME_TRANSITION_WIDTH;
          finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
        } else {
          finalParams = primaryBiomeDef.terrainParameters;
        }
      }
      // --- End of Biome determination logic ---

      // Height calculation using finalParams (mirrors heightAt.ts for LODLevel.HIGH / default)
      const h_noise = 
        noiseFunc1(sampleX * finalParams.noiseFreq1, sampleZ * finalParams.noiseFreq1) * finalParams.noiseAmp1 +
        noiseFunc2(sampleX * finalParams.noiseFreq2, sampleZ * finalParams.noiseFreq2) * finalParams.noiseAmp2 +
        noiseFunc3(sampleX * finalParams.noiseFreq3, sampleZ * finalParams.noiseFreq3) * finalParams.noiseAmp3;
      
      const currentSumAmps = finalParams.noiseAmp1 + finalParams.noiseAmp2 + finalParams.noiseAmp3;
      const normalized_h = currentSumAmps > 0 ? h_noise / currentSumAmps : 0;
      const terrainBase = (normalized_h + 1) * 0.5 * finalParams.mountainHeight;
      let height = Math.floor(terrainBase + finalParams.seaLevel + finalParams.baseHeight);
      
      // Clamp height to valid chunk height range (0 to CHUNK_HEIGHT - 1)
      height = Math.max(0, Math.min(CHUNK_HEIGHT - 1, height)); // Ensure height is at least 0 (not 1, as heightAt does for *final* block placement)
                                                               // For heightmap, raw calculated value before Math.max(1,..) is probably what's stored.
                                                               // heightAt.ts does: return { height: Math.max(1, finalHeight), biomeId: primaryBiomeDef.id };
                                                               // Let's match what genChunk's heightmap loop would get from heightFn.
                                                               // The heightFn inside heightAt.ts returns Math.max(1, finalHeight).
                                                               // So, this replication should also do Math.max(1, ...) if we want to match the *value*
                                                               // that genChunk's outputHeightmap would store from its call to heightFn.

      heightmap[x * CHUNK_DEPTH + z] = Math.max(1, height); // Match the Math.max(1, finalHeight) from heightAt.ts
    }
  }
  return heightmap;
}

/**
 * Derives a heightmap from a flat Uint8Array of voxel data.
 * Assumes standard Y-up coordinates and that 0 is air.
 */
export function deriveHeightmapFromVoxels(
  voxels: Uint8Array,
  cWidth: number,
  cHeight: number,
  cDepth: number
): Uint8Array {
  const heightmap = new Uint8Array(cWidth * cDepth);
  heightmap.fill(0); // Initialize heights to 0 (or lowest possible if terrain can be below Y=0)

  for (let x = 0; x < cWidth; x++) {
    for (let z = 0; z < cDepth; z++) {
      for (let y = cHeight - 1; y >= 0; y--) {
        const index = y * cWidth * cDepth + z * cWidth + x;
        if (voxels[index] > 0) { // Found a non-air block
          heightmap[x * cDepth + z] = y; // Corrected index
          break; 
        }
      }
    }
  }
  return heightmap;
}

/**
 * Compares two heightmaps (Uint8Array) and logs differences.
 * Returns true if identical, false otherwise.
 */
function compareHeightmaps(map1: Uint8Array, map2: Uint8Array, mapName1 = 'Map1', mapName2 = 'Map2'): boolean {
  if (map1.length !== map2.length) {
    console.error(`[S1-1 Test] Heightmap length mismatch: ${mapName1} (${map1.length}), ${mapName2} (${map2.length})`);
    return false;
  }
  let differences = 0;
  for (let i = 0; i < map1.length; i++) {
    if (map1[i] !== map2[i]) {
      differences++;
      if (differences < 10) { // Log first few differences
        const z = i % CHUNK_DEPTH;
        const x = Math.floor(i / CHUNK_DEPTH);
        console.warn(`[S1-1 Test] Diff at (${x},${z}): ${mapName1}=${map1[i]}, ${mapName2}=${map2[i]}`);
      }
    }
  }
  if (differences === 0) {
    console.log(`[S1-1 Test] Success: ${mapName1} and ${mapName2} are identical.`);
    return true;
  } else {
    console.error(`[S1-1 Test] Failed: ${mapName1} and ${mapName2} have ${differences} differing values.`);
    return false;
  }
}

export interface ServerGenChunkResult {
  voxels: Uint8Array;
  // lastModified can be Date or number, the test doesn't use it.
}

/**
 * Tests the S1-1 success criterion: server's genChunk(seed,0,0) 
 * returns voxels that produce an identical heightmap to the client's generation method.
 */
export async function testS1_1_HeightmapConsistency(
    serverGenChunkFn: (seed: number, cX: number, cZ: number) => ServerGenChunkResult | Promise<ServerGenChunkResult>,
    seed: number
): Promise<boolean> {
  console.log(`[S1-1 Test] Running heightmap consistency test for chunk (0,0) with seed ${seed}...`);

  // 1. Generate client-equivalent heightmap
  const clientHeightmap = replicateClientHeightmapGen(seed, 0, 0);
  console.log('[S1-1 Test] Client-equivalent heightmap generated.');

  // 2. Get server-generated voxels for chunk (0,0)
  let serverChunkResult;
  try {
    serverChunkResult = await serverGenChunkFn(seed, 0, 0);
    if (!serverChunkResult || !serverChunkResult.voxels) {
        console.error('[S1-1 Test] serverGenChunkFn did not return valid voxels.');
        return false;
    }
  } catch (e) {
    console.error('[S1-1 Test] Error calling serverGenChunkFn:', e);
    return false;
  }
  console.log('[S1-1 Test] Server voxels obtained from serverGenChunkFn.');
  
  // 3. Derive heightmap from server voxels
  const serverDerivedHeightmap = deriveHeightmapFromVoxels(
    serverChunkResult.voxels,
    CHUNK_WIDTH,
    CHUNK_HEIGHT,
    CHUNK_DEPTH
  );
  console.log('[S1-1 Test] Heightmap derived from server voxels.');

  // 4. Compare
  return compareHeightmaps(clientHeightmap, serverDerivedHeightmap, 'ClientEquivalentHeightmap', 'ServerDerivedHeightmap');
} 