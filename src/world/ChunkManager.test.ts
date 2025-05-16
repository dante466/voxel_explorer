import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { ChunkManager } from './ChunkManager';
import { NoiseManager } from './NoiseManager';
import { MesherManager } from './MesherManager';
import { Chunk } from './Chunk';

// Mock NoiseManager
vi.mock('./NoiseManager', () => ({
  NoiseManager: class MockNoiseManager {
    private seed: number;

    constructor(seed: number) {
      this.seed = seed;
    }

    async generateChunk(chunkX: number, chunkZ: number, lodLevel: number = 0): Promise<Chunk> {
      // Generate test chunk data based on coordinates
      const chunkData = new Uint8Array(32 * 128 * 32);
      
      // Fill with a pattern based on coordinates
      for (let i = 0; i < chunkData.length; i++) {
        const y = Math.floor(i / (32 * 32));
        const localX = Math.floor((i % (32 * 32)) / 32);
        const localZ = i % 32;
        
        // Create a simple terrain pattern
        const height = Math.floor(64 + Math.sin(chunkX * 0.1 + localX * 0.1) * 10 + Math.cos(chunkZ * 0.1 + localZ * 0.1) * 10);
        chunkData[i] = y < height ? 1 : 0;
      }

      const chunk = new Chunk(chunkX, chunkZ, lodLevel);
      chunk.decompress(chunkData);
      return chunk;
    }

    dispose() {
      // No cleanup needed
    }
  }
}));

// Mock MesherManager
vi.mock('./MesherManager', () => ({
  MesherManager: class MockMesherManager {
    async meshChunk(chunk: Chunk): Promise<THREE.BufferGeometry> {
      // Generate test mesh data for a simple cube
      const positions = new Float32Array([
        // Front face
        0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
        // Back face
        0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
        // Top face
        0, 1, 0,  1, 1, 0,  1, 1, 1,  0, 1, 1,
        // Bottom face
        0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1,
        // Right face
        1, 0, 0,  1, 1, 0,  1, 1, 1,  1, 0, 1,
        // Left face
        0, 0, 0,  0, 1, 0,  0, 1, 1,  0, 0, 1
      ]);

      const normals = new Float32Array([
        // Front face
        0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
        // Back face
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        // Top face
        0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
        // Bottom face
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
        // Right face
        1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
        // Left face
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0
      ]);

      const uvs = new Float32Array([
        // Front face
        0, 0,  1, 0,  1, 1,  0, 1,
        // Back face
        0, 0,  1, 0,  1, 1,  0, 1,
        // Top face
        0, 0,  1, 0,  1, 1,  0, 1,
        // Bottom face
        0, 0,  1, 0,  1, 1,  0, 1,
        // Right face
        0, 0,  1, 0,  1, 1,  0, 1,
        // Left face
        0, 0,  1, 0,  1, 1,  0, 1
      ]);

      const indices = new Uint32Array([
        // Front face
        0, 1, 2,  0, 2, 3,
        // Back face
        4, 5, 6,  4, 6, 7,
        // Top face
        8, 9, 10, 8, 10, 11,
        // Bottom face
        12, 13, 14, 12, 14, 15,
        // Right face
        16, 17, 18, 16, 18, 19,
        // Left face
        20, 21, 22, 20, 22, 23
      ]);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      return geometry;
    }

    dispose() {
      // No cleanup needed
    }
  }
}));

describe('ChunkManager', () => {
  let chunkManager: ChunkManager;
  let noiseManager: NoiseManager;
  let mesherManager: MesherManager;
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
    noiseManager = new NoiseManager(12345);
    mesherManager = new MesherManager();
    chunkManager = new ChunkManager(noiseManager, mesherManager, scene, 2, 25);
  });

  afterEach(() => {
    chunkManager.dispose();
  });

  it('should initialize with correct render distance and max chunks', () => {
    expect(chunkManager['renderDistance']).toBe(2);
    expect(chunkManager['maxLoadedChunks']).toBe(25);
  });

  it('should load chunks around player position', async () => {
    await chunkManager.update(0, 0, scene);
    expect(scene.children.length).toBeGreaterThan(0);
  });

  it('should unload chunks that are too far from player', async () => {
    // Load chunks at origin
    await chunkManager.update(0, 0, scene);
    const initialChunkCount = scene.children.length;
    expect(initialChunkCount).toBeGreaterThan(0);

    // Move player far away without loading new chunks
    await chunkManager.update(1000, 1000, scene, false);
    
    // Wait for chunks to unload
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check that old chunks were unloaded
    expect(scene.children.length).toBe(0);
  });

  it('should respect max loaded chunks limit', async () => {
    // Load more chunks than the limit
    for (let i = 0; i < 30; i++) {
      await chunkManager.update(i * 100, i * 100, scene);
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(scene.children.length).toBeLessThanOrEqual(25);
  });

  it('should handle errors during chunk loading', async () => {
    // Mock error in noise generation
    vi.spyOn(noiseManager, 'generateChunk').mockRejectedValueOnce(new Error('Test error'));
    
    // Should not throw
    await expect(chunkManager.update(0, 0, scene)).resolves.not.toThrow();
  });

  it('should properly dispose of resources', async () => {
    await chunkManager.update(0, 0, scene);
    expect(scene.children.length).toBeGreaterThan(0);
    
    chunkManager.dispose();
    expect(scene.children.length).toBe(0);
  });
}); 