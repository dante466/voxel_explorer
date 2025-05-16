import { LODLevel, CHUNK_SIZE, LOD_CHUNK_SIZE } from './Chunk';

// Message types
interface MeshChunkMessage {
  type: 'MESH_CHUNK';
  chunkX: number;
  chunkZ: number;
  lodLevel: LODLevel;
  data: Uint8Array;
}

interface WorkerResponse {
  type: 'MESH_GENERATED';
  chunkX: number;
  chunkZ: number;
  lodLevel: LODLevel;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

// Constants

// Helper function to get voxel data
function getVoxel(data: Uint8Array, x: number, y: number, z: number, size: typeof CHUNK_SIZE): number {
  if (x < 0 || x >= size.WIDTH || y < 0 || y >= size.HEIGHT || z < 0 || z >= size.DEPTH) {
    return 0;
  }
  return data[y * size.WIDTH * size.DEPTH + z * size.WIDTH + x];
}

// Helper function to check if a voxel is visible
function isVoxelVisible(data: Uint8Array, x: number, y: number, z: number, size: typeof CHUNK_SIZE): boolean {
  const voxel = getVoxel(data, x, y, z, size);
  if (voxel === 0) return false;

  // Check if any adjacent voxel is air
  return getVoxel(data, x + 1, y, z, size) === 0 ||
         getVoxel(data, x - 1, y, z, size) === 0 ||
         getVoxel(data, x, y + 1, z, size) === 0 ||
         getVoxel(data, x, y - 1, z, size) === 0 ||
         getVoxel(data, x, y, z + 1, size) === 0 ||
         getVoxel(data, x, y, z - 1, size) === 0;
}

// Initialize the worker
self.onmessage = async (e: MessageEvent<MeshChunkMessage>) => {
  if (e.data.type === 'MESH_CHUNK') {
    const { chunkX, chunkZ, lodLevel, data } = e.data;
    const size = lodLevel === LODLevel.HIGH ? CHUNK_SIZE : LOD_CHUNK_SIZE;
    
    // Arrays to store mesh data
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    
    // Generate mesh using greedy meshing
    for (let x = 0; x < size.WIDTH; x++) {
      for (let y = 0; y < size.HEIGHT; y++) {
        for (let z = 0; z < size.DEPTH; z++) {
          if (isVoxelVisible(data, x, y, z, size)) {
            const baseIndex = positions.length / 3;
            
            // Add faces for visible voxel
            // Front face
            positions.push(
              x, y, z + 1,
              x + 1, y, z + 1,
              x + 1, y + 1, z + 1,
              x, y + 1, z + 1
            );
            normals.push(
              0, 0, 1,
              0, 0, 1,
              0, 0, 1,
              0, 0, 1
            );
            uvs.push(
              0, 0,
              1, 0,
              1, 1,
              0, 1
            );
            indices.push(
              baseIndex, baseIndex + 1, baseIndex + 2,
              baseIndex, baseIndex + 2, baseIndex + 3
            );
            
            // Back face
            positions.push(
              x + 1, y, z,
              x, y, z,
              x, y + 1, z,
              x + 1, y + 1, z
            );
            normals.push(
              0, 0, -1,
              0, 0, -1,
              0, 0, -1,
              0, 0, -1
            );
            uvs.push(
              0, 0,
              1, 0,
              1, 1,
              0, 1
            );
            indices.push(
              baseIndex + 4, baseIndex + 5, baseIndex + 6,
              baseIndex + 4, baseIndex + 6, baseIndex + 7
            );
            
            // Top face
            positions.push(
              x, y + 1, z,
              x, y + 1, z + 1,
              x + 1, y + 1, z + 1,
              x + 1, y + 1, z
            );
            normals.push(
              0, 1, 0,
              0, 1, 0,
              0, 1, 0,
              0, 1, 0
            );
            uvs.push(
              0, 0,
              1, 0,
              1, 1,
              0, 1
            );
            indices.push(
              baseIndex + 8, baseIndex + 9, baseIndex + 10,
              baseIndex + 8, baseIndex + 10, baseIndex + 11
            );
            
            // Bottom face
            positions.push(
              x, y, z,
              x + 1, y, z,
              x + 1, y, z + 1,
              x, y, z + 1
            );
            normals.push(
              0, -1, 0,
              0, -1, 0,
              0, -1, 0,
              0, -1, 0
            );
            uvs.push(
              0, 0,
              1, 0,
              1, 1,
              0, 1
            );
            indices.push(
              baseIndex + 12, baseIndex + 13, baseIndex + 14,
              baseIndex + 12, baseIndex + 14, baseIndex + 15
            );
            
            // Right face
            positions.push(
              x + 1, y, z,
              x + 1, y + 1, z,
              x + 1, y + 1, z + 1,
              x + 1, y, z + 1
            );
            normals.push(
              1, 0, 0,
              1, 0, 0,
              1, 0, 0,
              1, 0, 0
            );
            uvs.push(
              0, 0,
              1, 0,
              1, 1,
              0, 1
            );
            indices.push(
              baseIndex + 16, baseIndex + 17, baseIndex + 18,
              baseIndex + 16, baseIndex + 18, baseIndex + 19
            );
            
            // Left face
            positions.push(
              x, y, z,
              x, y, z + 1,
              x, y + 1, z + 1,
              x, y + 1, z
            );
            normals.push(
              -1, 0, 0,
              -1, 0, 0,
              -1, 0, 0,
              -1, 0, 0
            );
            uvs.push(
              0, 0,
              1, 0,
              1, 1,
              0, 1
            );
            indices.push(
              baseIndex + 20, baseIndex + 21, baseIndex + 22,
              baseIndex + 20, baseIndex + 22, baseIndex + 23
            );
          }
        }
      }
    }
    
    // Send response back to main thread
    const response: WorkerResponse = {
      type: 'MESH_GENERATED',
      chunkX,
      chunkZ,
      lodLevel,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices)
    };
    
    self.postMessage(response);
  }
}; 