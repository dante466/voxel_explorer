import { makeNoise2D } from 'fast-simplex-noise';
import { BiomeId, Biomes, BIOME_NOISE_FREQUENCY, BIOME_NOISE_AMPLITUDE, PlainsBiome, BIOME_TRANSITION_WIDTH } from './biomeTypes';
import type { BiomeDefinition, BiomeTerrainParameters } from './biomeTypes';

// Constants previously in ../../shared/terrainConsts.js - NOW THESE WILL BE BIOME-SPECIFIC
// const BASE_HEIGHT = 10; // Example, will come from biome
// const SEA_LEVEL = 30; 
// const MOUNTAIN_HEIGHT = 40;
// const NOISE_FREQ_1 = 0.01;
// const NOISE_AMP_1 = 0.6;
// const NOISE_FREQ_2 = 0.05;
// const NOISE_AMP_2 = 0.3;
// const NOISE_FREQ_3 = 0.1;
// const NOISE_AMP_3 = 0.1;

// River Parameters
const RIVER_NOISE_FREQ = 0.002; // Very low frequency for winding rivers
const RIVER_NOISE_AMP = 1.0; // Amplitude for river noise
const RIVER_THRESHOLD = 0.05; // Values close to 0 (within this threshold) form the river path
const RIVER_DEPTH_FACTOR = 15; // How much to carve down for the river bed
const RIVER_BED_HEIGHT_VARIATION = 2; // Slight variation in river bed depth

// Simple mulberry32 PRNG
function mulberry32(a: number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0; a = Math.imul(a ^ a >>> 15, 1 | a);
    a = a + Math.imul(a ^ a >>> 7, 61 | a) | 0;
    return ((a ^ a >>> 14) >>> 0) / 4294967296;
  }
}

// Helper function to interpolate between two BiomeTerrainParameters objects
function interpolateTerrainParameters(
  baseParams: BiomeTerrainParameters,      // Parameters of the biome we are primarily in, or transitioning FROM
  targetParams: BiomeTerrainParameters,    // Parameters of the biome we are transitioning TO
  alpha: number                       // How much of targetParams to blend in (0 = 100% baseParams, 1 = 100% targetParams)
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

export interface HeightInfo {
  height: number;
  biomeId: BiomeId;
  //TODO: consider returning alpha or dominant/secondary biome for block blending in genChunk
}

// Define biome boundaries based on the biome noise value (ranging roughly -1 to 1)
const DESERT_PLAINS_BOUNDARY = -0.33;
const PLAINS_MOUNTAINS_BOUNDARY = 0.33;

export function makeHeightFn(seed: number, lodLevel: number): (wx: number, wz: number) => HeightInfo {
  const randomFuncBiome = mulberry32(seed ^ 0xabcdef01); // Seed for biome selection noise
  const noiseFuncBiome = makeNoise2D(randomFuncBiome); // Noise function for biome selection

  // Terrain noise functions (re-initialize per call to makeHeightFn to ensure seed propagation if needed, though PRNG state is captured by closure)
  const noiseFunc1 = makeNoise2D(mulberry32(seed));
  const noiseFunc2 = makeNoise2D(mulberry32(seed ^ 0xdeadbeef)); 
  const noiseFunc3 = makeNoise2D(mulberry32(seed ^ 0x41c64e6d));

  return (wx: number, wz: number): HeightInfo => {
    const biomeVal = noiseFuncBiome(wx * BIOME_NOISE_FREQUENCY, wz * BIOME_NOISE_FREQUENCY) * BIOME_NOISE_AMPLITUDE;

    let primaryBiomeDef: BiomeDefinition = PlainsBiome; // Fallback
    let finalParams: BiomeTerrainParameters;
    let calculatedAlpha = 0; // Default to 0 influence from a secondary biome

    if (biomeVal < DESERT_PLAINS_BOUNDARY) {
      primaryBiomeDef = Biomes.get(BiomeId.Desert) || PlainsBiome;
      const secondaryBiomeDef = Biomes.get(BiomeId.Plains) || PlainsBiome;
      // Transition: Desert (primary) -> Plains (secondary)
      if (biomeVal > DESERT_PLAINS_BOUNDARY - BIOME_TRANSITION_WIDTH) {
        calculatedAlpha = (biomeVal - (DESERT_PLAINS_BOUNDARY - BIOME_TRANSITION_WIDTH)) / BIOME_TRANSITION_WIDTH;
        finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
      } else {
        finalParams = primaryBiomeDef.terrainParameters;
      }
    } else if (biomeVal < PLAINS_MOUNTAINS_BOUNDARY) {
      primaryBiomeDef = Biomes.get(BiomeId.Plains) || PlainsBiome;
      // Transition: Plains (primary) -> Desert (secondary) OR Plains (primary) -> Mountains (secondary)
      if (biomeVal < DESERT_PLAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) { // Transitioning to Desert
        const secondaryBiomeDef = Biomes.get(BiomeId.Desert) || PlainsBiome;
        calculatedAlpha = ((DESERT_PLAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) - biomeVal) / BIOME_TRANSITION_WIDTH;
        finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
      } else if (biomeVal > PLAINS_MOUNTAINS_BOUNDARY - BIOME_TRANSITION_WIDTH) { // Transitioning to Mountains
        const secondaryBiomeDef = Biomes.get(BiomeId.Mountains) || PlainsBiome;
        calculatedAlpha = (biomeVal - (PLAINS_MOUNTAINS_BOUNDARY - BIOME_TRANSITION_WIDTH)) / BIOME_TRANSITION_WIDTH;
        finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
      } else {
        finalParams = primaryBiomeDef.terrainParameters;
      }
    } else { // biomeVal >= PLAINS_MOUNTAINS_BOUNDARY
      primaryBiomeDef = Biomes.get(BiomeId.Mountains) || PlainsBiome;
      const secondaryBiomeDef = Biomes.get(BiomeId.Plains) || PlainsBiome;
      // Transition: Mountains (primary) -> Plains (secondary)
      if (biomeVal < PLAINS_MOUNTAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) {
        calculatedAlpha = ((PLAINS_MOUNTAINS_BOUNDARY + BIOME_TRANSITION_WIDTH) - biomeVal) / BIOME_TRANSITION_WIDTH;
        finalParams = interpolateTerrainParameters(primaryBiomeDef.terrainParameters, secondaryBiomeDef.terrainParameters, calculatedAlpha);
      } else {
        finalParams = primaryBiomeDef.terrainParameters;
      }
    }
    
    let h_noise;
    let currentSumAmps = finalParams.noiseAmp1 + finalParams.noiseAmp2 + finalParams.noiseAmp3;

    if (lodLevel === 1) { // LOW_LOD
      currentSumAmps = finalParams.noiseAmp1 + finalParams.noiseAmp2;
      h_noise = 
        noiseFunc1(wx * finalParams.noiseFreq1, wz * finalParams.noiseFreq1) * finalParams.noiseAmp1 +
        noiseFunc2(wx * finalParams.noiseFreq2, wz * finalParams.noiseFreq2) * finalParams.noiseAmp2;
    } else if (lodLevel === 2) { // Even LOWER LOD
      currentSumAmps = finalParams.noiseAmp1;
      h_noise = 
        noiseFunc1(wx * finalParams.noiseFreq1, wz * finalParams.noiseFreq1) * finalParams.noiseAmp1;
    } else { // HIGH_LOD (lodLevel === 0 or default)
      h_noise = 
        noiseFunc1(wx * finalParams.noiseFreq1, wz * finalParams.noiseFreq1) * finalParams.noiseAmp1 +
        noiseFunc2(wx * finalParams.noiseFreq2, wz * finalParams.noiseFreq2) * finalParams.noiseAmp2 +
        noiseFunc3(wx * finalParams.noiseFreq3, wz * finalParams.noiseFreq3) * finalParams.noiseAmp3;
    }

    const normalized_h = currentSumAmps > 0 ? h_noise / currentSumAmps : 0;
    const terrainBaseVal = (normalized_h + 1) * 0.5 * finalParams.mountainHeight;
    const finalHeight = Math.floor(terrainBaseVal + finalParams.seaLevel + finalParams.baseHeight);
    
    return {
      height: Math.max(1, finalHeight), // Ensure height is at least 1
      biomeId: primaryBiomeDef.id 
      // Consider returning calculatedAlpha if genChunk needs it for block blending
    };
  };
} 