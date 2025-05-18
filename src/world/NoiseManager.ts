import { LODLevel } from '../shared/constants.js';
import { Chunk } from './Chunk';

interface ChunkGenerationRequest {
  chunkX: number;
  chunkZ: number;
  lodLevel: LODLevel;
  resolve: (chunk: Chunk) => void;
  reject: (error: Error) => void;
}

export class NoiseManager {
  private worker: Worker;
  private pendingRequests: Map<string, ChunkGenerationRequest> = new Map();
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.worker = new Worker(new URL('./noiseWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
  }

  private getChunkKey(chunkX: number, chunkZ: number, lodLevel: LODLevel): string {
    return `${chunkX},${chunkZ},${lodLevel}`;
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type, chunkX, chunkZ, lodLevel, data, heightmap } = e.data;
    
    if (type === 'CHUNK_GENERATED') {
      const key = this.getChunkKey(chunkX, chunkZ, lodLevel);
      const request = this.pendingRequests.get(key);
      
      if (request) {
        const chunk = new Chunk(chunkX, chunkZ, lodLevel);
        chunk.setData(data);
        chunk.setHeightmap(heightmap);
        request.resolve(chunk);
        this.pendingRequests.delete(key);
      }
    }
  }

  generateChunk(chunkX: number, chunkZ: number, lodLevel: LODLevel = LODLevel.HIGH): Promise<Chunk> {
    return new Promise((resolve, reject) => {
      const key = this.getChunkKey(chunkX, chunkZ, lodLevel);
      
      // Store the request
      this.pendingRequests.set(key, { chunkX, chunkZ, lodLevel, resolve, reject });
      
      // Send generation request to worker
      this.worker.postMessage({
        type: 'GENERATE_CHUNK',
        seed: this.seed,
        chunkX,
        chunkZ,
        lodLevel
      });
    });
  }

  dispose() {
    this.worker.terminate();
    this.pendingRequests.clear();
  }
} 