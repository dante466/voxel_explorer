import { BLOCK_AIR, BLOCK_DIRT, BLOCK_GRASS, BLOCK_SAND, BLOCK_STONE, BLOCK_WATER, BLOCK_OBSIDIAN, BLOCK_DARK_STONE } from '../../shared/constants';

export enum BiomeId {
  Plains = 'PLAINS',
  Mountains = 'MOUNTAINS',
  Desert = 'DESERT',
  Forest = 'FOREST',
  // Ocean = 'OCEAN', // For later
  // River = 'RIVER_BIOME', // For later, distinct from river carving feature
}

export interface BiomeTerrainParameters {
  // Basic terrain shape
  baseHeight: number;
  seaLevel: number; // Could be biome-specific if oceans are deep vs shallow lakes
  mountainHeight: number; // Controls max deviation for this biome's features

  // Noise parameters for terrain generation within this biome
  noiseFreq1: number;
  noiseAmp1: number;
  noiseFreq2: number;
  noiseAmp2: number;
  noiseFreq3: number;
  noiseAmp3: number;

  // TODO: Could add more parameters like:
  // - hillinessFactor: number (0-1)
  // - flatnessFactor: number (0-1)
  // - specific noise functions or seeds for this biome's character
}

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  terrainParameters: BiomeTerrainParameters;
  surfaceBlock: number; // Block ID
  subSurfaceBlock: number; // Block ID for layers underneath
  temperature: number; // Normalized 0.0 (cold) to 1.0 (hot)
  moisture: number;    // Normalized 0.0 (dry) to 1.0 (wet)
  // TODO: Add later
  // vegetation?: { type: string, density: number, blockId: number }[];
  // features?: { type: string, rarity: number, schematic: any }[];
}

// Retrieve global constants from shared/terrainConsts.ts to use as a baseline for Plains
// These are currently duplicated in heightAt.ts, should be centralized or passed appropriately.
// For now, we'll use the values from the project overview / current heightAt.ts structure.
const GLOBAL_BASE_HEIGHT = 10;
const GLOBAL_SEA_LEVEL = 30;
const GLOBAL_MOUNTAIN_HEIGHT = 40;
const GLOBAL_NOISE_FREQ_1 = 0.01;
const GLOBAL_NOISE_AMP_1 = 0.6;
const GLOBAL_NOISE_FREQ_2 = 0.05;
const GLOBAL_NOISE_AMP_2 = 0.3;
const GLOBAL_NOISE_FREQ_3 = 0.1;
const GLOBAL_NOISE_AMP_3 = 0.1;

export const PlainsBiome: BiomeDefinition = {
  id: BiomeId.Plains,
  name: 'Plains',
  terrainParameters: {
    baseHeight: GLOBAL_BASE_HEIGHT,
    seaLevel: GLOBAL_SEA_LEVEL,
    mountainHeight: GLOBAL_MOUNTAIN_HEIGHT * 0.5, // Plains are flatter
    noiseFreq1: GLOBAL_NOISE_FREQ_1,
    noiseAmp1: GLOBAL_NOISE_AMP_1 * 0.7, // Less amplitude for flatter plains
    noiseFreq2: GLOBAL_NOISE_FREQ_2,
    noiseAmp2: GLOBAL_NOISE_AMP_2 * 0.6,
    noiseFreq3: GLOBAL_NOISE_FREQ_3,
    noiseAmp3: GLOBAL_NOISE_AMP_3 * 0.5,
  },
  surfaceBlock: BLOCK_GRASS,
  subSurfaceBlock: BLOCK_DIRT,
  temperature: 0.5, // Temperate
  moisture: 0.5,    // Moderate moisture
};

export const MountainsBiome: BiomeDefinition = {
  id: BiomeId.Mountains,
  name: 'Mountains',
  terrainParameters: {
    baseHeight: GLOBAL_BASE_HEIGHT + 5, // Start a bit lower to make peaks feel taller from base
    seaLevel: GLOBAL_SEA_LEVEL, // Sea level is consistent for now
    mountainHeight: GLOBAL_MOUNTAIN_HEIGHT * 2.8, // Much more variation, very tall peaks
    noiseFreq1: GLOBAL_NOISE_FREQ_1 * 0.7, // Broader main mountain features
    noiseAmp1: GLOBAL_NOISE_AMP_1 * 2.0, // Higher amplitude for main features
    noiseFreq2: GLOBAL_NOISE_FREQ_2 * 1.5, // More medium-scale ruggedness
    noiseAmp2: GLOBAL_NOISE_AMP_2 * 1.8, // Increased amplitude for ruggedness
    noiseFreq3: GLOBAL_NOISE_FREQ_3 * 2.0, // Sharper, more jagged details
    noiseAmp3: GLOBAL_NOISE_AMP_3 * 2.2, // Higher amplitude for jagged details
  },
  surfaceBlock: BLOCK_DARK_STONE, // Mountain tops are dark stone
  subSurfaceBlock: BLOCK_STONE,   // Underlayer is regular stone, or could also be dark stone
  temperature: 0.2, // Colder, high altitude & evil vibe
  moisture: 0.3,    // Generally drier, rocky
  // Consider BLOCK_OBSIDIAN for peaks or specific features later
};

export const DesertBiome: BiomeDefinition = {
  id: BiomeId.Desert,
  name: 'Desert',
  terrainParameters: {
    baseHeight: GLOBAL_BASE_HEIGHT + 5, // Deserts can be slightly elevated
    seaLevel: GLOBAL_SEA_LEVEL - 5, // Water table might be lower
    mountainHeight: GLOBAL_MOUNTAIN_HEIGHT * 0.7, // Dunes and some hills
    noiseFreq1: GLOBAL_NOISE_FREQ_1 * 1.2, // Different dune patterns
    noiseAmp1: GLOBAL_NOISE_AMP_1 * 0.8,
    noiseFreq2: GLOBAL_NOISE_FREQ_2 * 0.8, // Smoother large features
    noiseAmp2: GLOBAL_NOISE_AMP_2 * 0.7,
    noiseFreq3: GLOBAL_NOISE_FREQ_3 * 0.5, // Less small noise
    noiseAmp3: GLOBAL_NOISE_AMP_3 * 0.4,
  },
  surfaceBlock: BLOCK_SAND,
  subSurfaceBlock: BLOCK_SAND, // Sand deep down, or could be sandstone
  temperature: 0.9, // Hot
  moisture: 0.1,    // Very dry
};


// A map to easily access biome definitions by ID
export const Biomes: Map<BiomeId, BiomeDefinition> = new Map([
  [BiomeId.Plains, PlainsBiome],
  [BiomeId.Mountains, MountainsBiome],
  [BiomeId.Desert, DesertBiome],
]);

// Constants for biome selection noise
export const BIOME_NOISE_FREQUENCY = 0.001; // Very low frequency for large biome areas
export const BIOME_NOISE_AMPLITUDE = 1.0;

// Defines how wide the transition zone is, in terms of the biome noise value range (e.g., 0.0 to 1.0).
// A value of 0.1 means that 10% of the biome noise range around a boundary will be a transition zone.
export const BIOME_TRANSITION_WIDTH = 0.1; 