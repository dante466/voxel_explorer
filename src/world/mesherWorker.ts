import { LODLevel, CHUNK_SIZE, LOD_CHUNK_SIZE } from './Chunk';
import { BlockId, getBlockType, getUVsForTile, ATLAS_COLS, ATLAS_ROWS, DIRT_TILE } from '../world/blockTypes';

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

// Helper function to get voxel ID at coordinates
function getVoxelId(data: Uint8Array, x: number, y: number, z: number, size: typeof CHUNK_SIZE): number {
  if (x < 0 || x >= size.WIDTH || y < 0 || y >= size.HEIGHT || z < 0 || z >= size.DEPTH) {
    return BlockId.AIR; // Treat out-of-bounds as Air for culling
  }
  return data[y * size.WIDTH * size.DEPTH + z * size.WIDTH + x];
}

// Initialize the worker
self.onmessage = async (e: MessageEvent<MeshChunkMessage>) => {
  if (e.data.type === 'MESH_CHUNK') {
    const { chunkX, chunkZ, lodLevel, data } = e.data;
    const size = lodLevel === LODLevel.HIGH ? CHUNK_SIZE : LOD_CHUNK_SIZE;
    
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexIndexOffset = 0; // Used to calculate indices for each new quad
    
    for (let y = 0; y < size.HEIGHT; y++) {
      for (let z = 0; z < size.DEPTH; z++) {
        for (let x = 0; x < size.WIDTH; x++) {
          const blockId = getVoxelId(data, x, y, z, size);

          if (blockId === BlockId.AIR) {
            continue; // Skip air blocks
          }

          const blockType = getBlockType(blockId);
          let tileToUse: [number, number];
          let uvData;

          // Determine tile coordinates for each face, using DIRT_TILE as a fallback.
          const faces = blockType?.textureFaces || {
            top: DIRT_TILE,
            bottom: DIRT_TILE,
            sides: DIRT_TILE,
          };

          // Face culling: Check adjacent blocks
          // X+ (Right face of current block)
          if (getVoxelId(data, x + 1, y, z, size) === BlockId.AIR) {
            tileToUse = faces.sides;
            uvData = getUVsForTile(tileToUse[0], tileToUse[1], ATLAS_COLS, ATLAS_ROWS);
            positions.push(x + 1, y, z, x + 1, y + 1, z, x + 1, y + 1, z + 1, x + 1, y, z + 1);
            normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
            uvs.push(uvData.uMin, uvData.vMin, uvData.uMin, uvData.vMax, uvData.uMax, uvData.vMax, uvData.uMax, uvData.vMin); // Adjusted for typical texture orientation on this face
            indices.push(vertexIndexOffset, vertexIndexOffset + 1, vertexIndexOffset + 2, vertexIndexOffset, vertexIndexOffset + 2, vertexIndexOffset + 3);
            vertexIndexOffset += 4;
          }

          // X- (Left face of current block)
          if (getVoxelId(data, x - 1, y, z, size) === BlockId.AIR) {
            tileToUse = faces.sides;
            uvData = getUVsForTile(tileToUse[0], tileToUse[1], ATLAS_COLS, ATLAS_ROWS);
            positions.push(x, y, z + 1, x, y + 1, z + 1, x, y + 1, z, x, y, z);
            normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
            uvs.push(uvData.uMin, uvData.vMin, uvData.uMin, uvData.vMax, uvData.uMax, uvData.vMax, uvData.uMax, uvData.vMin); // Adjusted
            indices.push(vertexIndexOffset, vertexIndexOffset + 1, vertexIndexOffset + 2, vertexIndexOffset, vertexIndexOffset + 2, vertexIndexOffset + 3);
            vertexIndexOffset += 4;
          }

          // Y+ (Top face of current block)
          if (getVoxelId(data, x, y + 1, z, size) === BlockId.AIR) {
            tileToUse = faces.top;
            uvData = getUVsForTile(tileToUse[0], tileToUse[1], ATLAS_COLS, ATLAS_ROWS);
            positions.push(x, y + 1, z, x, y + 1, z + 1, x + 1, y + 1, z + 1, x + 1, y + 1, z);
            normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            // Reverted to standard UV mapping for the top face for all blocks
            uvs.push(uvData.uMin, uvData.vMax, 
                       uvData.uMin, uvData.vMin, 
                       uvData.uMax, uvData.vMin, 
                       uvData.uMax, uvData.vMax);
            indices.push(vertexIndexOffset, vertexIndexOffset + 1, vertexIndexOffset + 2, vertexIndexOffset, vertexIndexOffset + 2, vertexIndexOffset + 3);
            vertexIndexOffset += 4;
          }

          // Y- (Bottom face of current block)
          if (getVoxelId(data, x, y - 1, z, size) === BlockId.AIR) {
            tileToUse = faces.bottom;
            uvData = getUVsForTile(tileToUse[0], tileToUse[1], ATLAS_COLS, ATLAS_ROWS);
            positions.push(x + 1, y, z, x + 1, y, z + 1, x, y, z + 1, x, y, z);
            normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
            uvs.push(uvData.uMax, uvData.vMax, uvData.uMax, uvData.vMin, uvData.uMin, uvData.vMin, uvData.uMin, uvData.vMax); // Adjusted: Bottom face often 1,1 to 0,0
            indices.push(vertexIndexOffset, vertexIndexOffset + 1, vertexIndexOffset + 2, vertexIndexOffset, vertexIndexOffset + 2, vertexIndexOffset + 3);
            vertexIndexOffset += 4;
          }

          // Z+ (Front face of current block)
          if (getVoxelId(data, x, y, z + 1, size) === BlockId.AIR) {
            tileToUse = faces.sides;
            uvData = getUVsForTile(tileToUse[0], tileToUse[1], ATLAS_COLS, ATLAS_ROWS);
            positions.push(x, y, z + 1, x + 1, y, z + 1, x + 1, y + 1, z + 1, x, y + 1, z + 1);
            normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
            uvs.push(uvData.uMin, uvData.vMin, uvData.uMax, uvData.vMin, uvData.uMax, uvData.vMax, uvData.uMin, uvData.vMax);
            indices.push(vertexIndexOffset, vertexIndexOffset + 1, vertexIndexOffset + 2, vertexIndexOffset, vertexIndexOffset + 2, vertexIndexOffset + 3);
            vertexIndexOffset += 4;
          }

          // Z- (Back face of current block)
          if (getVoxelId(data, x, y, z - 1, size) === BlockId.AIR) {
            tileToUse = faces.sides;
            uvData = getUVsForTile(tileToUse[0], tileToUse[1], ATLAS_COLS, ATLAS_ROWS);
            positions.push(x + 1, y, z, x, y, z, x, y + 1, z, x + 1, y + 1, z);
            normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
            uvs.push(uvData.uMin, uvData.vMin, uvData.uMax, uvData.vMin, uvData.uMax, uvData.vMax, uvData.uMin, uvData.vMax);
            indices.push(vertexIndexOffset, vertexIndexOffset + 1, vertexIndexOffset + 2, vertexIndexOffset, vertexIndexOffset + 2, vertexIndexOffset + 3);
            vertexIndexOffset += 4;
          }
        }
      }
    }
    
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