export enum BlockId {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  // Add more block types here
}

// Atlas dimensions
export const ATLAS_COLS = 2; // Grass, Dirt
export const ATLAS_ROWS = 1;

// Texture coordinates [column, row] in the atlas
export const GRASS_TOP_TILE: [number, number] = [0, 0];
export const DIRT_TILE: [number, number] = [1, 0]; // Dirt is at column 1, row 0
export const STONE_TILE: [number, number] = [1, 0]; // Default stone to look like dirt for now

export interface BlockTextureFaces {
  top: [number, number];    // [col, row]
  bottom: [number, number]; // [col, row]
  sides: [number, number];  // [col, row]
}

export interface BlockType {
  id: BlockId;
  name: string;
  isSolid: boolean;
  textureFaces?: BlockTextureFaces; // Optional: if not defined, mesher might use a default or error
  // textureName?: string; // No longer needed as we use the atlas and textureFaces
}

export const blockTypes: Record<BlockId, BlockType> = {
  [BlockId.AIR]: {
    id: BlockId.AIR,
    name: 'Air',
    isSolid: false,
  },
  [BlockId.GRASS]: {
    id: BlockId.GRASS,
    name: 'Grass',
    isSolid: true,
    textureFaces: {
      top: GRASS_TOP_TILE,    // Grass texture for top
      bottom: DIRT_TILE,    // Dirt texture for bottom
      sides: DIRT_TILE,     // Dirt texture for sides
    },
  },
  [BlockId.DIRT]: {
    id: BlockId.DIRT,
    name: 'Dirt',
    isSolid: true,
    textureFaces: {
      top: DIRT_TILE,       // Dirt texture for all faces
      bottom: DIRT_TILE,
      sides: DIRT_TILE,
    },
  },
  [BlockId.STONE]: {
    id: BlockId.STONE,
    name: 'Stone',
    isSolid: true,
    textureFaces: {
      top: STONE_TILE,      // Stone texture for all faces (currently dirt)
      bottom: STONE_TILE,
      sides: STONE_TILE,
    },
  },
};

// Helper function to get block type properties
export function getBlockType(id: number): BlockType | undefined {
  return blockTypes[id as BlockId];
}

/**
 * Calculates UV coordinates for a given tile in a texture atlas.
 * @param tileCol The column of the tile in the atlas (0-indexed).
 * @param tileRow The row of the tile in the atlas (0-indexed).
 * @param atlasNumCols Total columns in the atlas.
 * @param atlasNumRows Total rows in the atlas.
 * @returns { uMin, vMin, uMax, vMax }
 */
export function getUVsForTile(tileCol: number, tileRow: number, atlasNumCols: number = ATLAS_COLS, atlasNumRows: number = ATLAS_ROWS) {
  const uMin = tileCol / atlasNumCols;
  const uMax = (tileCol + 1) / atlasNumCols;
  // THREE.js UVs have V origin at the bottom, so we flip V
  const vMin = 1 - (tileRow + 1) / atlasNumRows;
  const vMax = 1 - tileRow / atlasNumRows;
  return { uMin, vMin, uMax, vMax };
} 