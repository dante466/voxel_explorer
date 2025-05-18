import { makeNoise2D } from 'fast-simplex-noise';

// Constants previously in ../../shared/terrainConsts.js
// Terrain Shape
const BASE_HEIGHT = 10;
const SEA_LEVEL = 30; // Average height of water/flat areas
const MOUNTAIN_HEIGHT = 40; // Max height deviation from SEA_LEVEL + BASE_HEIGHT

// Noise Parameters (example values, adjust as needed)
const NOISE_FREQ_1 = 0.01; // Frequency for the first octave of noise
const NOISE_AMP_1 = 0.6;   // Amplitude for the first octave
const NOISE_FREQ_2 = 0.05; // Frequency for the second octave
const NOISE_AMP_2 = 0.3;   // Amplitude for the second octave
const NOISE_FREQ_3 = 0.1;  // Frequency for the third octave
const NOISE_AMP_3 = 0.1;   // Amplitude for the third octave

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