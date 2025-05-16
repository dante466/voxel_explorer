import { describe, it, expect, beforeEach } from 'vitest';
import { MockWorker } from './__mocks__/worker';

// Replace global Worker with MockWorker
global.Worker = MockWorker as any;

describe('MesherWorker', () => {
  let worker: Worker;

  beforeEach(() => {
    worker = new Worker(new URL('./mesherWorker.ts', import.meta.url), { type: 'module' });
  });

  it('should generate correct mesh for a simple cube', async () => {
    const chunk = createTestChunk();
    const mesh = await new Promise<any>((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.postMessage({ type: 'MESH_CHUNK', data: chunk.data });
    });

    // Check mesh data structure
    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.uvs).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);

    // Check array sizes
    expect(mesh.positions.length).toBe(72); // 6 faces * 4 vertices * 3 components
    expect(mesh.normals.length).toBe(72); // 6 faces * 4 vertices * 3 components
    expect(mesh.uvs.length).toBe(48); // 6 faces * 4 vertices * 2 components
    expect(mesh.indices.length).toBe(36); // 6 faces * 2 triangles * 3 vertices

    // Check that all positions are within bounds
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i]).toBeLessThanOrEqual(1);
      expect(mesh.positions[i + 1]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i + 1]).toBeLessThanOrEqual(1);
      expect(mesh.positions[i + 2]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i + 2]).toBeLessThanOrEqual(1);
    }

    // Check that all normals are unit vectors
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.sqrt(
        mesh.normals[i] * mesh.normals[i] +
        mesh.normals[i + 1] * mesh.normals[i + 1] +
        mesh.normals[i + 2] * mesh.normals[i + 2]
      );
      expect(length).toBeCloseTo(1, 5);
    }

    // Check that all UVs are in [0,1] range
    for (let i = 0; i < mesh.uvs.length; i++) {
      expect(mesh.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.uvs[i]).toBeLessThanOrEqual(1);
    }
  }, 1000);

  it('should merge faces in the same plane', async () => {
    const chunk = createTestChunk();
    const mesh = await new Promise<any>((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.postMessage({ type: 'MESH_CHUNK', data: chunk.data });
    });

    // Check that we have the expected number of vertices for a cube
    expect(mesh.positions.length).toBe(72); // 6 faces * 4 vertices * 3 components
    expect(mesh.indices.length).toBe(36); // 6 faces * 2 triangles * 3 vertices
  }, 1000);

  it('should handle empty chunks', async () => {
    const chunk = createEmptyChunk();
    const mesh = await new Promise<any>((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.postMessage({ type: 'MESH_CHUNK', data: chunk.data });
    });

    // Even for empty chunks, we should get a valid mesh structure
    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.uvs).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
  }, 1000);
});

function createTestChunk() {
  const data = new Uint8Array(32 * 128 * 32);
  // Create a 3x3x3 cube in the center of the chunk
  for (let x = 14; x < 17; x++) {
    for (let y = 14; y < 17; y++) {
      for (let z = 14; z < 17; z++) {
        data[x + y * 32 + z * 32 * 128] = 1;
      }
    }
  }
  return { data };
}

function createEmptyChunk() {
  return { data: new Uint8Array(32 * 128 * 32) };
} 