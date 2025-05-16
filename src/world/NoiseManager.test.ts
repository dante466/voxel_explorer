import { describe, it, expect, beforeEach } from 'vitest';
import { NoiseManager } from './NoiseManager';
import { Chunk } from './Chunk';
import { MockWorker } from './__mocks__/worker';

// Replace global Worker with MockWorker
global.Worker = MockWorker as any;

describe('NoiseManager', () => {
  let noiseManager: NoiseManager;

  beforeEach(() => {
    noiseManager = new NoiseManager(12345); // Fixed seed for deterministic tests
  });

  it('should generate chunks deterministically with the same seed', async () => {
    const chunk1 = await noiseManager.generateChunk(0, 0);
    const chunk2 = await noiseManager.generateChunk(0, 0);
    expect(chunk1.getData()).toEqual(chunk2.getData());
  }, 1000);

  it('should generate different chunks for different coordinates', async () => {
    const chunk1 = await noiseManager.generateChunk(0, 0);
    const chunk2 = await noiseManager.generateChunk(1, 1);
    expect(chunk1.getData()).not.toEqual(chunk2.getData());
  }, 1000);

  it('should generate chunks with valid block types', async () => {
    const chunk = await noiseManager.generateChunk(0, 0);
    const data = chunk.getData();
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(32 * 128 * 32);
    
    // Check that all block types are valid (0 or 1)
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  }, 1000);

  it('should handle multiple concurrent chunk requests', async () => {
    const promises = [
      noiseManager.generateChunk(0, 0),
      noiseManager.generateChunk(1, 0),
      noiseManager.generateChunk(0, 1)
    ];

    const chunks = await Promise.all(promises);
    expect(chunks).toHaveLength(3);
    
    // Verify each chunk is valid
    chunks.forEach(chunk => {
      const data = chunk.getData();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(32 * 128 * 32);
    });

    // Verify chunks are different
    expect(chunks[0].getData()).not.toEqual(chunks[1].getData());
    expect(chunks[0].getData()).not.toEqual(chunks[2].getData());
    expect(chunks[1].getData()).not.toEqual(chunks[2].getData());
  }, 1000);
}); 