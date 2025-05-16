export const CHUNK_SIZE = {
  WIDTH: 32,
  HEIGHT: 32,
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
  }

  // Fill chunk with a single value
  fill(value: number): void {
    this.data.fill(value);
    this.compressedData = null;
  }
} 