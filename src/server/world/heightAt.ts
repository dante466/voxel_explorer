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

export function makeHeightFn(seed: number) {
  const randomFunc1 = mulberry32(seed);
  const randomFunc2 = mulberry32(seed ^ 0xdeadbeef); 
  const randomFunc3 = mulberry32(seed ^ 0x41c64e6d);

  // Create three distinct 2D noise functions, each with its own seeded PRNG
  const noiseFunc1 = makeNoise2D(randomFunc1);
  const noiseFunc2 = makeNoise2D(randomFunc2);
  const noiseFunc3 = makeNoise2D(randomFunc3);

  const SUM_AMPS = NOISE_AMP_1 + NOISE_AMP_2 + NOISE_AMP_3;

  return (wx: number, wz: number): number => {
    // h_noise is the sum of three noise octaves, each typically in [-1, 1] before amplitude multiplication
    const h_noise = 
      noiseFunc1(wx * NOISE_FREQ_1, wz * NOISE_FREQ_1) * NOISE_AMP_1 +
      noiseFunc2(wx * NOISE_FREQ_2, wz * NOISE_FREQ_2) * NOISE_AMP_2 +
      noiseFunc3(wx * NOISE_FREQ_3, wz * NOISE_FREQ_3) * NOISE_AMP_3;

    // Normalize combined noise (which can range from -SUM_AMPS to +SUM_AMPS) to roughly [-1, 1]
    const normalized_h = h_noise / SUM_AMPS;

    // Normalise −1…1 → 0…1, scale by mountain height,
    // then add sea level and base height.
    const terrainBase = (normalized_h + 1) * 0.5 * MOUNTAIN_HEIGHT;
    
    return Math.floor(terrainBase + SEA_LEVEL + BASE_HEIGHT);
  };
} 