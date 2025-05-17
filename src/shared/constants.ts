export const CHUNK_SIZE_X = 32;
export const CHUNK_SIZE_Y = 128;
export const CHUNK_SIZE_Z = 32;
export const AREA = CHUNK_SIZE_X * CHUNK_SIZE_Z; // Typically used for 2D indexing within a chunk's XZ plane

export const BLOCK_AIR = 0;
export const BLOCK_DIRT = 1;
export const BLOCK_STONE = 2;
// Add other block types here as needed, ensuring IDs match any client-side enums/usage. 