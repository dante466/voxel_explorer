import {
  NOISE_FREQ_1, NOISE_FREQ_2, NOISE_FREQ_3,
  NOISE_AMP_1, NOISE_AMP_2, NOISE_AMP_3,
  BASE_HEIGHT, SEA_LEVEL, MOUNTAIN_HEIGHT
} from '../../shared/terrainConsts.js';
import { makeNoise2D } from 'fast-simplex-noise';

// Simple mulberry32 PRNG
function mulberry32(a: number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0; a = Math.imul(a ^ a >>> 15, 1 | a);
    a = a + Math.imul(a ^ a >>> 7, 61 | a) | 0;
    return ((a ^ a >>> 14) >>> 0) / 4294967296;
  }
}

export function makeHeightFn(seed: number, lodLevel: number) {
  const randomFunc1 = mulberry32(seed);
  const randomFunc2 = mulberry32(seed ^ 0xdeadbeef); 
  const randomFunc3 = mulberry32(seed ^ 0x41c64e6d);

  // Create three distinct 2D noise functions, each with its own seeded PRNG
  const noiseFunc1 = makeNoise2D(randomFunc1);
  const noiseFunc2 = makeNoise2D(randomFunc2);
  const noiseFunc3 = makeNoise2D(randomFunc3);

  // Adjust sum of amplitudes based on LOD
  let currentSumAmps = NOISE_AMP_1 + NOISE_AMP_2 + NOISE_AMP_3;
  if (lodLevel === 1) { // LOW_LOD - use only first two octaves for example
    currentSumAmps = NOISE_AMP_1 + NOISE_AMP_2;
  } else if (lodLevel === 2) { // Example for an even LOWER LOD - use only first octave
    currentSumAmps = NOISE_AMP_1;
  }
  // Default (lodLevel === 0 or other) uses all three.

  return (wx: number, wz: number): number => {
    let h_noise;
    if (lodLevel === 1) { // LOW_LOD - use only first two octaves
      h_noise = 
        noiseFunc1(wx * NOISE_FREQ_1, wz * NOISE_FREQ_1) * NOISE_AMP_1 +
        noiseFunc2(wx * NOISE_FREQ_2, wz * NOISE_FREQ_2) * NOISE_AMP_2;
    } else if (lodLevel === 2) { // Even LOWER LOD - use only first octave
      h_noise = 
        noiseFunc1(wx * NOISE_FREQ_1, wz * NOISE_FREQ_1) * NOISE_AMP_1;
    } else { // HIGH_LOD (lodLevel === 0 or default)
      h_noise = 
        noiseFunc1(wx * NOISE_FREQ_1, wz * NOISE_FREQ_1) * NOISE_AMP_1 +
        noiseFunc2(wx * NOISE_FREQ_2, wz * NOISE_FREQ_2) * NOISE_AMP_2 +
        noiseFunc3(wx * NOISE_FREQ_3, wz * NOISE_FREQ_3) * NOISE_AMP_3;
    }

    // Normalize combined noise to roughly [-1, 1]
    // Ensure currentSumAmps is not zero to avoid division by zero if all amps are conditional
    const normalized_h = currentSumAmps > 0 ? h_noise / currentSumAmps : 0;

    // Normalise −1…1 → 0…1, scale by mountain height,
    // then add sea level and base height.
    const terrainBase = (normalized_h + 1) * 0.5 * MOUNTAIN_HEIGHT;
    
    return Math.floor(terrainBase + SEA_LEVEL + BASE_HEIGHT);
  };
} 