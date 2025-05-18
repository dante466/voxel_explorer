import { makeNoise2D, makeNoise3D } from 'fast-simplex-noise';
import { LODLevel, CHUNK_SIZE, LOD_CHUNK_SIZE } from '../shared/constants.js';

// Message types
interface GenerateChunkMessage {
  type: 'GENERATE_CHUNK';
  seed: number;
  chunkX: number;
  chunkZ: number;
  lodLevel: LODLevel;
}

interface WorkerResponse {
  type: 'CHUNK_GENERATED';
  chunkX: number;
  chunkZ: number;
  lodLevel: LODLevel;
  data: Uint8Array;
  heightmap: Uint8Array;
}

// Constants for terrain generation
const SEA_LEVEL = 64;
const MOUNTAIN_HEIGHT = 40;
const BASE_HEIGHT = 20;

// Initialize noise generators
let noise2D: (x: number, y: number) => number;
let noise3D: (x: number, y: number, z: number) => number;

// Initialize the worker
self.onmessage = async (e: MessageEvent<GenerateChunkMessage>) => {
  if (e.data.type === 'GENERATE_CHUNK') {
    const { seed, chunkX, chunkZ, lodLevel } = e.data;
    
    // Initialize noise generators with seed
    noise2D = makeNoise2D(() => seed);
    noise3D = makeNoise3D(() => seed);
    
    // Generate chunk data
    const { data, heightmap } = generateChunk(chunkX, chunkZ, lodLevel);
    
    // Send response back to main thread
    const response: WorkerResponse = {
      type: 'CHUNK_GENERATED',
      chunkX,
      chunkZ,
      lodLevel,
      data,
      heightmap
    };
    
    self.postMessage(response);
  }
};

function generateChunk(chunkX: number, chunkZ: number, lodLevel: LODLevel): { data: Uint8Array; heightmap: Uint8Array } {
  const size = lodLevel === LODLevel.HIGH ? CHUNK_SIZE : LOD_CHUNK_SIZE;
  const data = new Uint8Array(size.WIDTH * size.HEIGHT * size.DEPTH);
  const heightmap = new Uint8Array(size.WIDTH * size.DEPTH);
  
  // Generate heightmap first
  for (let x = 0; x < size.WIDTH; x++) {
    for (let z = 0; z < size.DEPTH; z++) {
      const worldX = chunkX * size.WIDTH + x;
      const worldZ = chunkZ * size.DEPTH + z;
      
      // Generate base terrain height using multiple octaves of noise
      let height = BASE_HEIGHT;
      height += noise2D(worldX * 0.01, worldZ * 0.01) * MOUNTAIN_HEIGHT;
      height += noise2D(worldX * 0.02, worldZ * 0.02) * (MOUNTAIN_HEIGHT * 0.5);
      height += noise2D(worldX * 0.04, worldZ * 0.04) * (MOUNTAIN_HEIGHT * 0.25);
      
      // Scale height for LOD
      if (lodLevel === LODLevel.LOW) {
        height = Math.floor(height / 2);
      }
      
      // Clamp height to valid range
      height = Math.max(0, Math.min(size.HEIGHT - 1, Math.floor(height + SEA_LEVEL)));
      heightmap[x * size.DEPTH + z] = height;
      
      // Fill voxels below height
      for (let y = 0; y < height; y++) {
        // Add some 3D noise for terrain features
        const featureNoise = noise3D(worldX * 0.1, y * 0.1, worldZ * 0.1);
        
        // Determine block type based on height and noise
        let blockType = 1; // Default to dirt
        if (y === height - 1) {
          blockType = 2; // Grass on top
        } else if (y < height - 4) {
          blockType = 3; // Stone deeper down
        }
        
        // Add some caves using 3D noise
        if (featureNoise > 0.3) {
          blockType = 0; // Air for caves
        }
        
        data[y * size.WIDTH * size.DEPTH + z * size.WIDTH + x] = blockType;
      }
    }
  }
  
  return { data, heightmap };
} 