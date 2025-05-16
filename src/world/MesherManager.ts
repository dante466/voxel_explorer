import { Chunk, LODLevel } from './Chunk';

interface PendingRequest {
  resolve: (mesh: ChunkMesh) => void;
  reject: (error: Error) => void;
}

interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export class MesherManager {
  private worker: Worker;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  constructor() {
    this.worker = new Worker(new URL('./mesherWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
  }

  private getChunkKey(chunkX: number, chunkZ: number, lodLevel: LODLevel): string {
    return `${chunkX},${chunkZ},${lodLevel}`;
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type, chunkX, chunkZ, lodLevel, positions, normals, uvs, indices } = e.data;
    
    if (type === 'MESH_GENERATED') {
      const key = this.getChunkKey(chunkX, chunkZ, lodLevel);
      const request = this.pendingRequests.get(key);
      
      if (request) {
        request.resolve({ positions, normals, uvs, indices });
        this.pendingRequests.delete(key);
      }
    }
  }

  async meshChunk(chunk: Chunk): Promise<ChunkMesh> {
    return new Promise((resolve, reject) => {
      const key = this.getChunkKey(chunk.x, chunk.z, chunk.lodLevel);
      
      // Store the request
      this.pendingRequests.set(key, { resolve, reject });
      
      // Send chunk data to worker
      this.worker.postMessage({
        type: 'MESH_CHUNK',
        chunkX: chunk.x,
        chunkZ: chunk.z,
        lodLevel: chunk.lodLevel,
        data: chunk.getData()
      });
    });
  }

  dispose() {
    this.worker.terminate();
    this.pendingRequests.clear();
  }
} 