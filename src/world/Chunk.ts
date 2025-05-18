import { CHUNK_SIZE, LOD_CHUNK_SIZE, LODLevel } from '../shared/constants.js';

// export const CHUNK_SIZE = { // REMOVED LOCAL DEFINITION
//   WIDTH: 32,
//   HEIGHT: 128,
//   DEPTH: 32
// };

// export const LOD_CHUNK_SIZE = { // REMOVED LOCAL DEFINITION
//   WIDTH: 16,
//   HEIGHT: 16,
//   DEPTH: 16
// };

// Use imported constants for volume calculation if needed, or define them here based on imported CHUNK_SIZE/LOD_CHUNK_SIZE
export const CHUNK_VOLUME = CHUNK_SIZE.WIDTH * CHUNK_SIZE.HEIGHT * CHUNK_SIZE.DEPTH;
export const LOD_CHUNK_VOLUME = LOD_CHUNK_SIZE.WIDTH * LOD_CHUNK_SIZE.HEIGHT * LOD_CHUNK_SIZE.DEPTH;

// export enum LODLevel { // REMOVED LOCAL DEFINITION
//   HIGH = 0,  // 32x128x32
//   LOW = 1    // 16x64x16 -> Note: comment was 16x64x16, but LOD_CHUNK_SIZE.HEIGHT is 16.
// }

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
    const currentChunkSize = this.getSizeConstants(); // LOD-aware size of this.data (e.g., 16xH_lowx16 or 32xH_highx32)
    const targetHeightmapWidth = CHUNK_SIZE.WIDTH; // Always 32 for the target heightmap
    const targetHeightmapDepth = CHUNK_SIZE.DEPTH; // Always 32 for the target heightmap

    if (this.heightmap.length !== targetHeightmapWidth * targetHeightmapDepth) {
      console.warn(`[Chunk] Heightmap has unexpected size (${this.heightmap.length}), re-initializing to ${targetHeightmapWidth * targetHeightmapDepth}. LOD: ${this.lodLevel}`);
      this.heightmap = new Uint8Array(targetHeightmapWidth * targetHeightmapDepth);
    }
    
    // Scaling factor if this chunk's data is smaller than the target heightmap dimensions
    // e.g., if chunk is 16wide (LOW_LOD) and heightmap is 32wide, scale is 32/16 = 2.
    const xScale = targetHeightmapWidth / currentChunkSize.WIDTH;
    const zScale = targetHeightmapDepth / currentChunkSize.DEPTH;

    for (let hx = 0; hx < targetHeightmapWidth; hx++) { // Iterate over target 32x32 heightmap grid
      for (let hz = 0; hz < targetHeightmapDepth; hz++) {
        // Map target heightmap coordinates (hx, hz) back to the chunk's local data coordinates (lx, lz)
        // If HIGH LOD, xScale/zScale is 1, so lx=hx, lz=hz.
        // If LOW LOD (e.g. 16wide data for 32wide map), lx = hx / 2.
        const lx = Math.floor(hx / xScale);
        const lz = Math.floor(hz / zScale);

        let yMax = 0;
        // Scan down from the top of this chunk's actual data height
        for (let ly = currentChunkSize.HEIGHT - 1; ly >= 0; ly--) {
          // getVoxel uses lx, ly, lz which are in the coordinate space of this.data
          const voxelValue = this.getVoxel(lx, ly, lz); 
          if (voxelValue !== 0) { 
            yMax = ly; // yMax is in the local ly coordinate system of the chunk data
            break;
          }
        }
        
        // If LOW LOD, yMax (e.g., 0-15) needs to be scaled to world-comparable height
        // if other systems expect heightmap values to be in a consistent range.
        // For now, store the yMax relative to the chunk's data height.
        // If CHUNK_SIZE.HEIGHT is 128 and currentChunkSize.HEIGHT is 16,
        // then yMax should be scaled by 128/16 = 8 if storing world-scale height.
        // However, the original code stored local yMax, so let's stick to that for now for direct replacement.
        // The heightFn on server produces world-scale heights. Client heightmap was storing local y.
        // This part is tricky: what should heightmap values represent?
        // Let's assume for now yMax should be scaled to reflect a value comparable to a HIGH LOD chunk's y range.
        let finalHeightForMap = yMax;
        if (this.lodLevel === LODLevel.LOW) {
             // Scale yMax from LOW_LOD chunk.data height range to CHUNK_SIZE.HEIGHT range
             finalHeightForMap = Math.floor(yMax * (CHUNK_SIZE.HEIGHT / currentChunkSize.HEIGHT));
        }


        const heightmapIndex = hz * targetHeightmapWidth + hx;
        this.heightmap[heightmapIndex] = finalHeightForMap;
      }
    }
  }
} 