export const CHUNK_SIZE = {
  WIDTH: 32,
  HEIGHT: 128,
  DEPTH: 32
};

export const LOD_CHUNK_SIZE = {
  WIDTH: 16,
  HEIGHT: 16,
  DEPTH: 16
};

export const CHUNK_VOLUME = CHUNK_SIZE.WIDTH * CHUNK_SIZE.HEIGHT * CHUNK_SIZE.DEPTH;
export const LOD_CHUNK_VOLUME = LOD_CHUNK_SIZE.WIDTH * LOD_CHUNK_SIZE.HEIGHT * LOD_CHUNK_SIZE.DEPTH;

export enum LODLevel {
  HIGH = 0,  // 32x128x32
  LOW = 1    // 16x64x16
}

export class Chunk {
  private data: Uint8Array;
  private compressedData: Uint8Array | null = null;
  private heightmap: Uint8Array;
  public readonly x: number;
  public readonly z: number;
  public readonly lodLevel: LODLevel;

  constructor(x: number, z: number, lodLevel: LODLevel = LODLevel.HIGH) {
    this.lodLevel = lodLevel;
    const size = lodLevel === LODLevel.HIGH ? CHUNK_VOLUME : LOD_CHUNK_VOLUME;
    this.data = new Uint8Array(size);
    this.heightmap = new Uint8Array(32 * 32);
    this.x = x;
    this.z = z;
  }

  // Check if a block exists at the given coordinates
  hasBlock(x: number, y: number, z: number): boolean {
    return this.getVoxel(x, y, z) !== 0;
  }

  getHeightmap(): Uint8Array {
    return this.heightmap;
  }

  setHeightmap(heightmap: Uint8Array) {
    this.heightmap = heightmap;
  }

  // Get voxel at x,y,z coordinates
  getVoxel(x: number, y: number, z: number): number {
    if (!this.isInBounds(x, y, z)) return 0;
    return this.data[this.getIndex(x, y, z)];
  }

  // Set voxel at x,y,z coordinates
  setVoxel(x: number, y: number, z: number, value: number): void {
    if (!this.isInBounds(x, y, z)) return;
    this.data[this.getIndex(x, y, z)] = value;
    this.compressedData = null; // Invalidate compression cache
  }

  // Get the appropriate size constants based on LOD level
  private getSizeConstants() {
    return this.lodLevel === LODLevel.HIGH ? CHUNK_SIZE : LOD_CHUNK_SIZE;
  }

  // Check if coordinates are within chunk bounds
  private isInBounds(x: number, y: number, z: number): boolean {
    const size = this.getSizeConstants();
    return x >= 0 && x < size.WIDTH &&
           y >= 0 && y < size.HEIGHT &&
           z >= 0 && z < size.DEPTH;
  }

  // Convert 3D coordinates to 1D array index
  private getIndex(x: number, y: number, z: number): number {
    const size = this.getSizeConstants();
    return y * size.WIDTH * size.DEPTH + z * size.WIDTH + x;
  }

  // Set voxel at a flat 1D array index
  setVoxelByFlatIndex(index: number, value: number): void {
    const size = this.getSizeConstants();
    const currentVolume = size.WIDTH * size.HEIGHT * size.DEPTH;
    if (index >= 0 && index < currentVolume) {
      this.data[index] = value;
      this.compressedData = null; // Invalidate compression cache
    } else {
      console.warn(`Attempted to set voxel by flat index ${index} which is out of bounds for current LOD volume ${currentVolume}.`);
    }
  }

  // Compress chunk data using RLE
  compress(): Uint8Array {
    if (this.compressedData) return this.compressedData;

    const result: number[] = [];
    let currentValue = this.data[0];
    let count = 1;

    for (let i = 1; i < this.data.length; i++) {
      if (this.data[i] === currentValue) {
        if (count === 255) {
          // Max run length reached, start a new run
          result.push(count, currentValue);
          count = 1;
        } else {
          count++;
        }
      } else {
        result.push(count, currentValue);
        currentValue = this.data[i];
        count = 1;
      }
    }
    result.push(count, currentValue);

    this.compressedData = new Uint8Array(result);
    return this.compressedData;
  }

  // Decompress RLE data into chunk
  decompress(compressed: Uint8Array): void {
    let dataIndex = 0;
    for (let i = 0; i < compressed.length; i += 2) {
      const count = compressed[i];
      const value = compressed[i + 1];
      for (let j = 0; j < count; j++) {
        if (dataIndex < this.data.length) {
          this.data[dataIndex++] = value;
        }
      }
    }
    this.compressedData = compressed;
  }

  // Get raw chunk data
  getData(): Uint8Array {
    return this.data;
  }

  // Set raw chunk data directly
  setData(rawData: Uint8Array): void {
    const expectedVolume = this.lodLevel === LODLevel.HIGH ? CHUNK_VOLUME : LOD_CHUNK_VOLUME;
    if (rawData.length !== expectedVolume) {
      console.error(`Attempted to set data with incorrect length. Expected ${expectedVolume}, got ${rawData.length} for LOD ${this.lodLevel}`);
      // Optionally, throw an error or handle it more gracefully
      return;
    }
    this.data = rawData;
    this.compressedData = null; // Invalidate compression cache
    this.regenerateHeightmapFromData();
  }

  // Fill chunk with a single value
  fill(value: number): void {
    this.data.fill(value);
    this.compressedData = null;
    this.regenerateHeightmapFromData();
  }

  // New method to regenerate heightmap
  private regenerateHeightmapFromData(): void {
    const size = this.getSizeConstants(); // Use LOD-aware sizes for iterating data
    const heightmapSize = CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH; // Heightmap is always 32x32 as per current init

    if (this.heightmap.length !== heightmapSize) {
      // This case should ideally not happen if constructor is consistent, but as a safeguard:
      console.warn(`[Chunk] Heightmap has unexpected size (${this.heightmap.length}), re-initializing to ${heightmapSize}. LOD: ${this.lodLevel}`);
      this.heightmap = new Uint8Array(heightmapSize);
    }
    
    // If chunk data is LOW LOD, we might need a strategy to map it to a HIGH LOD 32x32 heightmap,
    // or the heightmap itself should be LOD-aware in size.
    // For now, assuming we generate a 32x32 heightmap.
    // If size.WIDTH/DEPTH are different from CHUNK_SIZE.WIDTH/DEPTH (i.e. LOW LOD), this will be problematic.
    // Let\'s proceed with assumption that heightmap is always based on CHUNK_SIZE (32x32) for now.
    // And that voxel data, even if LOW_LOD, will be iterated in a way that can inform this.

    // Simplification: if this is a LOW_LOD chunk, this heightmap generation will be incorrect
    // as it assumes iteration up to CHUNK_SIZE.HEIGHT using CHUNK_SIZE.WIDTH/DEPTH for indexing into heightmap.
    // This needs refinement if LOW_LOD chunks are actively used with this heightmap logic.
    // For S1-3, client requests HIGH LOD, so this should be okay for now.
    
    for (let lx = 0; lx < CHUNK_SIZE.WIDTH; lx++) { // Renamed x to lx to avoid conflict with this.x
      for (let lz = 0; lz < CHUNK_SIZE.DEPTH; lz++) { // Renamed z to lz to avoid conflict with this.z
        let yMax = 0; // Default to 0 if no solid block found
        
        // DEBUG LOGGING START
        if (this.x === -1 && this.z === -1 && lx === 31 && lz === 21 && import.meta.env.DEV) {
          console.log(`[HMap Scan Entry] Chunk(${this.x},${this.z}) Col(${lx},${lz}) --- Begin Y Scan ---`);
        }
        // DEBUG LOGGING END

        for (let y = size.HEIGHT - 1; y >= 0; y--) {
          const voxelValue = this.getVoxel(lx, y, lz); 
          
          // DEBUG LOGGING START
          if (this.x === -1 && this.z === -1 && lx === 31 && lz === 21 && (y >= 98 && y <= 101) && import.meta.env.DEV) {
            console.log(`[HMap Scan Detail] Chunk(${this.x},${this.z}) Col(${lx},${lz}) Y=${y}, Voxel=${voxelValue}`);
          }
          // DEBUG LOGGING END
          
          if (voxelValue !== 0) { 
            yMax = y;
            // DEBUG LOGGING START
            if (this.x === -1 && this.z === -1 && lx === 31 && lz === 21 && import.meta.env.DEV) {
              console.log(`[HMap Scan FoundSolid] Chunk(${this.x},${this.z}) Col(${lx},${lz}) Solid at Y=${y}. Set yMax=${yMax}. Breaking.`);
            }
            // DEBUG LOGGING END
            break;
          }
        }
        // DEBUG LOGGING START
        if (this.x === -1 && this.z === -1 && lx === 31 && lz === 21 && import.meta.env.DEV) {
          console.log(`[HMap Scan Result] Chunk(${this.x},${this.z}) Col(${lx},${lz}) Final yMax for assign = ${yMax}`);
        }
        // DEBUG LOGGING END
        const heightmapIndex = lz * CHUNK_SIZE.WIDTH + lx; // Corrected indexing: lz first, then lx
        this.heightmap[heightmapIndex] = yMax;
      }
    }
    // console.log(`[Chunk ${this.x},${this.z}] Regenerated heightmap. Sample H[0,0]=${this.heightmap[0]}`);
  }
} 