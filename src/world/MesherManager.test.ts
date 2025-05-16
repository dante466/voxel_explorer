import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MesherManager } from './MesherManager';
import { Chunk, LODLevel } from './Chunk';

// Mock Worker
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(data: any) {
    // Simulate worker response
    setTimeout(() => {
      if (this.onmessage) {
        // Generate mock mesh data
        const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
        const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
        const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
        const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

        this.onmessage({
          data: {
            type: 'MESH_GENERATED',
            chunkX: data.chunkX,
            chunkZ: data.chunkZ,
            lodLevel: data.lodLevel,
            positions,
            normals,
            uvs,
            indices
          }
        } as MessageEvent);
      }
    }, 0);
  }
  terminate() {}
}

// Replace global Worker with MockWorker
global.Worker = MockWorker as any;

describe('MesherManager', () => {
  let manager: MesherManager;

  beforeAll(() => {
    manager = new MesherManager();
  });

  afterAll(() => {
    manager.dispose();
  });

  it('should mesh a chunk and return valid mesh data', async () => {
    const chunk = new Chunk(0, 0, LODLevel.HIGH);
    chunk.fill(1); // Fill with solid blocks

    const mesh = await manager.meshChunk(chunk);

    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.uvs).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);

    // Check array lengths
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.normals.length).toBeGreaterThan(0);
    expect(mesh.uvs.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);

    // Check that positions and normals have matching lengths
    expect(mesh.positions.length).toBe(mesh.normals.length);
  });

  it('should handle multiple concurrent meshing requests', async () => {
    const chunks = [
      new Chunk(0, 0, LODLevel.HIGH),
      new Chunk(1, 0, LODLevel.LOW),
      new Chunk(0, 1, LODLevel.HIGH)
    ];

    chunks.forEach(chunk => chunk.fill(1));

    const meshes = await Promise.all(chunks.map(chunk => manager.meshChunk(chunk)));

    expect(meshes).toHaveLength(3);
    meshes.forEach(mesh => {
      expect(mesh.positions).toBeInstanceOf(Float32Array);
      expect(mesh.normals).toBeInstanceOf(Float32Array);
      expect(mesh.uvs).toBeInstanceOf(Float32Array);
      expect(mesh.indices).toBeInstanceOf(Uint32Array);
    });
  });

  it('should handle empty chunks', async () => {
    const chunk = new Chunk(0, 0, LODLevel.HIGH);
    // Leave chunk empty (all zeros)

    const mesh = await manager.meshChunk(chunk);

    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.uvs).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
  });
}); 