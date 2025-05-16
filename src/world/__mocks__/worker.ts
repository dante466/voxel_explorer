// Mock Worker implementation
export class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor(url: string | URL) {
    // No initialization needed
  }

  postMessage(data: any) {
    // Process message synchronously
    const url = data.url?.toString() || '';
    let response;

    if (url.includes('noiseWorker') || data.type === 'GENERATE_CHUNK') {
      // Generate test chunk data based on coordinates
      const chunkData = new Uint8Array(32 * 128 * 32);
      const { chunkX, chunkZ } = data;
      
      // Fill with a pattern based on coordinates
      for (let i = 0; i < chunkData.length; i++) {
        // Use coordinates to generate different patterns
        const y = Math.floor(i / (32 * 32));
        const localX = Math.floor((i % (32 * 32)) / 32);
        const localZ = i % 32;
        
        // Create a simple terrain pattern
        const height = Math.floor(64 + Math.sin(chunkX * 0.1 + localX * 0.1) * 10 + Math.cos(chunkZ * 0.1 + localZ * 0.1) * 10);
        chunkData[i] = y < height ? 1 : 0;
      }

      response = {
        type: 'CHUNK_GENERATED',
        chunkX: data.chunkX,
        chunkZ: data.chunkZ,
        lodLevel: data.lodLevel,
        data: chunkData,
        heightmap: new Float32Array(32 * 32).fill(64)
      };
    } else if (url.includes('mesherWorker') || data.type === 'MESH_CHUNK') {
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

      response = {
        type: 'MESH_GENERATED',
        positions,
        normals,
        uvs,
        indices
      };
    }

    // Send response immediately
    if (this.onmessage && response) {
      this.onmessage({ data: response } as MessageEvent);
    }
  }

  terminate() {
    // No cleanup needed
  }
} 