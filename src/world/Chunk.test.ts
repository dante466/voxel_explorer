import { describe, it, expect } from 'vitest';
import { Chunk, CHUNK_SIZE, CHUNK_VOLUME } from './Chunk';

describe('Chunk', () => {
  it('should initialize with zeros', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.getVoxel(0, 0, 0)).toBe(0);
    expect(chunk.getVoxel(1, 1, 1)).toBe(0);
  });

  it('should set and get voxels correctly', () => {
    const chunk = new Chunk(0, 0);
    chunk.setVoxel(1, 1, 1, 5);
    expect(chunk.getVoxel(1, 1, 1)).toBe(5);
  });

  it('should handle out of bounds coordinates', () => {
    const chunk = new Chunk(0, 0);
    chunk.setVoxel(-1, 0, 0, 1);
    chunk.setVoxel(CHUNK_SIZE.WIDTH, 0, 0, 1);
    chunk.setVoxel(0, -1, 0, 1);
    chunk.setVoxel(0, CHUNK_SIZE.HEIGHT, 0, 1);
    chunk.setVoxel(0, 0, -1, 1);
    chunk.setVoxel(0, 0, CHUNK_SIZE.DEPTH, 1);
    
    expect(chunk.getVoxel(-1, 0, 0)).toBe(0);
    expect(chunk.getVoxel(CHUNK_SIZE.WIDTH, 0, 0)).toBe(0);
    expect(chunk.getVoxel(0, -1, 0)).toBe(0);
    expect(chunk.getVoxel(0, CHUNK_SIZE.HEIGHT, 0)).toBe(0);
    expect(chunk.getVoxel(0, 0, -1)).toBe(0);
    expect(chunk.getVoxel(0, 0, CHUNK_SIZE.DEPTH)).toBe(0);
  });

  it('should compress and decompress data correctly', () => {
    const chunk = new Chunk(0, 0);
    
    // Fill with a pattern
    for (let x = 0; x < CHUNK_SIZE.WIDTH; x++) {
      for (let y = 0; y < CHUNK_SIZE.HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE.DEPTH; z++) {
          chunk.setVoxel(x, y, z, (x + y + z) % 2);
        }
      }
    }

    const compressed = chunk.compress();
    const newChunk = new Chunk(0, 0);
    newChunk.decompress(compressed);

    // Verify data matches
    for (let x = 0; x < CHUNK_SIZE.WIDTH; x++) {
      for (let y = 0; y < CHUNK_SIZE.HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE.DEPTH; z++) {
          expect(newChunk.getVoxel(x, y, z)).toBe(chunk.getVoxel(x, y, z));
        }
      }
    }
  });

  it('should cache compression results', () => {
    const chunk = new Chunk(0, 0);
    chunk.fill(1);
    
    const compressed1 = chunk.compress();
    const compressed2 = chunk.compress();
    
    expect(compressed1).toBe(compressed2);
    
    chunk.setVoxel(0, 0, 0, 2);
    const compressed3 = chunk.compress();
    expect(compressed3).not.toBe(compressed1);
  });

  it('should fill chunk with a single value', () => {
    const chunk = new Chunk(0, 0);
    chunk.fill(3);
    
    for (let x = 0; x < CHUNK_SIZE.WIDTH; x++) {
      for (let y = 0; y < CHUNK_SIZE.HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE.DEPTH; z++) {
          expect(chunk.getVoxel(x, y, z)).toBe(3);
        }
      }
    }
  });

  it('should handle large runs of identical values efficiently', () => {
    const chunk = new Chunk(0, 0);
    chunk.fill(1);
    
    const compressed = chunk.compress();
    // For a chunk filled with identical values, compression should be very efficient
    // Each run can be at most 255 values, so we need multiple runs
    const expectedRuns = Math.ceil(CHUNK_VOLUME / 255);
    expect(compressed.length).toBe(expectedRuns * 2); // Each run is 2 bytes [count, value]
    
    // Verify all runs have the correct values
    for (let i = 0; i < expectedRuns; i++) {
      const runLength = i === expectedRuns - 1 ? CHUNK_VOLUME % 255 || 255 : 255;
      expect(compressed[i * 2]).toBe(runLength);     // Count
      expect(compressed[i * 2 + 1]).toBe(1);         // Value
    }
  });

  it('should maintain coordinate system consistency', () => {
    const chunk = new Chunk(0, 0);
    const testCoords = [
      [0, 0, 0],
      [CHUNK_SIZE.WIDTH - 1, 0, 0],
      [0, CHUNK_SIZE.HEIGHT - 1, 0],
      [0, 0, CHUNK_SIZE.DEPTH - 1],
      [CHUNK_SIZE.WIDTH - 1, CHUNK_SIZE.HEIGHT - 1, CHUNK_SIZE.DEPTH - 1]
    ];

    testCoords.forEach(([x, y, z], index) => {
      const value = index + 1;
      chunk.setVoxel(x, y, z, value);
      expect(chunk.getVoxel(x, y, z)).toBe(value);
    });
  });

  it('should handle compression edge cases', () => {
    const chunk = new Chunk(0, 0);
    
    // Test alternating values
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      chunk.setVoxel(
        i % CHUNK_SIZE.WIDTH,
        Math.floor(i / (CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH)),
        Math.floor((i % (CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH)) / CHUNK_SIZE.WIDTH),
        i % 2
      );
    }

    const compressed = chunk.compress();
    const newChunk = new Chunk(0, 0);
    newChunk.decompress(compressed);

    // Verify all values match
    for (let x = 0; x < CHUNK_SIZE.WIDTH; x++) {
      for (let y = 0; y < CHUNK_SIZE.HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE.DEPTH; z++) {
          expect(newChunk.getVoxel(x, y, z)).toBe(chunk.getVoxel(x, y, z));
        }
      }
    }
  });

  it('should handle maximum run length correctly', () => {
    const chunk = new Chunk(0, 0);
    const maxRunLength = 255;
    
    // Fill first 255 positions with 1
    for (let i = 0; i < maxRunLength; i++) {
      chunk.setVoxel(
        i % CHUNK_SIZE.WIDTH,
        Math.floor(i / (CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH)),
        Math.floor((i % (CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH)) / CHUNK_SIZE.WIDTH),
        1
      );
    }
    
    // Set next position to 2
    chunk.setVoxel(
      maxRunLength % CHUNK_SIZE.WIDTH,
      Math.floor(maxRunLength / (CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH)),
      Math.floor((maxRunLength % (CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH)) / CHUNK_SIZE.WIDTH),
      2
    );

    const compressed = chunk.compress();
    expect(compressed[0]).toBe(maxRunLength); // First run should be max length
    expect(compressed[1]).toBe(1);           // First value
    expect(compressed[2]).toBe(1);           // Second run length
    expect(compressed[3]).toBe(2);           // Second value
  });

  it('should maintain data integrity after multiple compress/decompress cycles', () => {
    const chunk = new Chunk(0, 0);
    
    // Fill with a complex pattern
    for (let x = 0; x < CHUNK_SIZE.WIDTH; x++) {
      for (let y = 0; y < CHUNK_SIZE.HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE.DEPTH; z++) {
          chunk.setVoxel(x, y, z, (x + y + z) % 4);
        }
      }
    }

    // Perform multiple compress/decompress cycles
    for (let i = 0; i < 5; i++) {
      const compressed = chunk.compress();
      const newChunk = new Chunk(0, 0);
      newChunk.decompress(compressed);
      
      // Verify data integrity
      for (let x = 0; x < CHUNK_SIZE.WIDTH; x++) {
        for (let y = 0; y < CHUNK_SIZE.HEIGHT; y++) {
          for (let z = 0; z < CHUNK_SIZE.DEPTH; z++) {
            expect(newChunk.getVoxel(x, y, z)).toBe(chunk.getVoxel(x, y, z));
          }
        }
      }
    }
  });
}); 