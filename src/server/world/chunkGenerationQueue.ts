import { genChunk } from './genChunk.js';
// Re-define GenChunkResult as it's not directly exported by genChunk.ts
export type GenChunkResult = Awaited<ReturnType<typeof genChunk>>;
// import { chunkKey } from './chunkUtils.js'; // Not used for LOD-specific key here
import type { MatchState } from '../types.js'; // MatchState from src/server/types.ts
import type { Chunk } from './types.js'; // Chunk from src/server/world/types.ts
import { buildChunkColliders } from '../physics/buildChunkColliders.js'; // Added buildChunkColliders
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from '../../shared/constants'; // Added imports

// Define a type for the task stored in the queue
interface ChunkGenTask {
  seed: number;
  cx: number;
  cz: number;
  lodLevel: number;
  key: string; // LOD-specific key
  state: MatchState; // Added MatchState
  resolve: (chunk: Chunk) => void; // Changed from GenChunkResult to Chunk
  reject: (reason?: any) => void;
}

export class ChunkGenerationQueue {
  private queue: ChunkGenTask[] = [];
  private processing: Set<string> = new Set(); // Stores keys of chunks currently being processed
  private pendingGenerations: Map<string, Promise<Chunk>> = new Map(); // Changed from GenChunkResult to Chunk
  private concurrency: number;

  constructor(concurrency: number = 4) {
    this.concurrency = concurrency;
    console.log(`[ChunkGenQueue] Initialized with concurrency: ${this.concurrency}`);
  }

  enqueue(
    state: MatchState, // Added MatchState
    seed: number,
    cx: number,
    cz: number,
    lodLevel: number
  ): Promise<Chunk> { // Changed from GenChunkResult to Chunk
    const key = `${cx},${cz},L${lodLevel}`; // Use manual LOD-specific key

    if (this.pendingGenerations.has(key)) {
      return this.pendingGenerations.get(key)!;
    }

    const promise = new Promise<Chunk>((resolve, reject) => { // Changed from GenChunkResult to Chunk
      this.queue.push({ state, seed, cx, cz, lodLevel, key, resolve, reject });
      this.tryProcessNext();
    });

    this.pendingGenerations.set(key, promise);
    return promise;
  }

  private tryProcessNext(): void {
    if (this.queue.length === 0 || this.processing.size >= this.concurrency) {
      return;
    }

    const task = this.queue.shift();
    if (task) {
      this.processing.add(task.key);
      this.processChunk(task)
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.processing.delete(task.key);
          this.pendingGenerations.delete(task.key); // Remove from pending once processed (success or fail)
          this.tryProcessNext();
        });
    }
  }

  private async processChunk(task: ChunkGenTask): Promise<Chunk> { // Changed from GenChunkResult to Chunk
    const { state, seed, cx, cz, lodLevel, key } = task;
    // console.log(`[ChunkGenQueue] Starting generation for ${key}`);
    try {
      const genResult: GenChunkResult = await genChunk(seed, cx, cz, lodLevel);
      
      if (!genResult || !genResult.voxels || genResult.voxels.length === 0) {
        console.error(`[ChunkGenQueue] genChunk returned empty or invalid data for ${key}`);
        throw new Error(`genChunk failed for ${key}`);
      }

      const newChunk: Chunk = {
        x: cx,
        z: cz,
        data: genResult.voxels,
        heightmap: genResult.heightmap,
        lastModified: genResult.lastModified,
        colliderHandles: [],
        lodLevel: lodLevel,
        lastAccessed: Date.now(),
        isGenerated: true,
      };

      // Add the chunk to the main MatchState chunks map BEFORE building colliders
      state.chunks.set(key, newChunk);
      // Resolve the promise with the Chunk object NOW, so client gets voxel data sooner
      // task.resolve(newChunk); // This was original placement, moved up for earlier resolve

      // Now, schedule collider building. This happens after the promise for chunk data is resolved.
      if (state.physicsWorld && state.physicsWorld.raw) {
        buildChunkColliders(
          state.physicsWorld.raw,
          newChunk, // Pass the created chunk object
          newChunk.data, 
          cx,
          cz,
          state 
        );
        // console.log(`[ChunkGenQueue] Collider building enqueued for ${key}.`);
      } else {
        console.warn(`[ChunkGenQueue ProcessChunk] physicsWorld or raw not available for ${key}. Colliders not built.`);
      }
      
      // console.log(`[ChunkGenQueue] Successfully generated, enqueued colliders, and cached ${key}.`);
      return newChunk; // Resolve with the Chunk object (original position, effectively resolves after collider queueing now)
    } catch (error) {
      console.error(`[ChunkGenQueue] Error processing chunk ${key}:`, error);
      throw error; // Re-throw to be caught by the caller in tryProcessNext
    }
  }

  public getQueueStatus(): { queueSize: number, processingCount: number, pendingCount: number } {
    return {
      queueSize: this.queue.length,
      processingCount: this.processing.size,
      pendingCount: this.pendingGenerations.size
    };
  }
} 