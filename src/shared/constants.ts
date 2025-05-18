export const CHUNK_SIZE_X = 32;
export const CHUNK_SIZE_Y = 128;
export const CHUNK_SIZE_Z = 32;
export const AREA = CHUNK_SIZE_X * CHUNK_SIZE_Z; // Typically used for 2D indexing within a chunk's XZ plane

// CHUNK_SIZE as an object (matches client Chunk.ts)
export const CHUNK_SIZE = {
  WIDTH: CHUNK_SIZE_X,
  HEIGHT: CHUNK_SIZE_Y,
  DEPTH: CHUNK_SIZE_Z
};

// LODLevel enum (matches client Chunk.ts and server genChunk.ts usage)
export enum LODLevel {
  HIGH = 0,
  LOW = 1
}

// LOD_CHUNK_SIZE as an object (matches client Chunk.ts and server genChunk.ts usage)
// For now, hardcoding. Could also be CHUNK_SIZE / 2 in dimensions if always the case.
export const LOD_CHUNK_SIZE = {
  WIDTH: 16,
  HEIGHT: 16, // Note: Client Chunk.ts LOD_CHUNK_SIZE.HEIGHT is 16. Server genChunk also used 16.
  DEPTH: 16
};

export const BLOCK_AIR = 0;
export const BLOCK_DIRT = 1;
export const BLOCK_STONE = 2;
// Add other block types here as needed, ensuring IDs match any client-side enums/usage. 

export const PLAYER_SPAWN_POS = { x: 0, y: 72, z: 0 }; 