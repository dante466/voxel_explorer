// src/server/world/getOrCreate.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MatchState as IServerMatchState } from '../types'; // Actual MatchState from types.ts
import { getBlock } from './voxelIO'; // We are testing getBlock which uses getOrCreateChunk
// import { createServerECSWorld } from '../ecs/world.js'; // Not strictly needed if using IServerMatchState

// Mock genChunk to avoid actual noise generation during this specific unit test
// and to control its output for predictable testing.
vi.mock('./genChunk.js', () => ({
  genChunk: vi.fn((seed: number, cx: number, cz: number) => {
    // Return a very simple, predictable chunk for testing purposes
    const voxels = new Uint8Array(32 * 128 * 32).fill(1); // Fill with stone for example
    if (cx === 0 && cz === 0 && seed === 321) {
        voxels[ (70 * 32 * 32) + (5 * 32) + 5 ] = 5; // Expected block for the specific test case
    }
    return { voxels, lastModified: Date.now() };
  }),
}));


describe('S1-3: On-demand chunk loading via getOrCreateChunk (tested via getBlock)', () => {
  let state: IServerMatchState;

  beforeEach(() => {
    // Reset state for each test
    state = {
      seed: 321,
      chunks: new Map(),
      players: new Map(),
      lastUpdate: Date.now(),
      // ecsWorld is part of the extended MatchState in matchServer.ts, 
      // but not in IServerMatchState from types.ts which voxelIO and getOrCreateChunk use.
      // If MatchState from matchServer.ts was used, we'd need: ecsWorld: createServerECSWorld()
    };
  });

  it('auto-generates missing chunk on first access via getBlock', () => {
    // World (5,70,5) is in chunk (0,0) because 5/32 is 0 for cx, cz.
    const val = getBlock(state, state.seed, 5, 70, 5); 
    expect(state.chunks.size).toBe(1); // Chunk (0,0) should have been created
    
    const createdChunk = state.chunks.get('0,0');
    expect(createdChunk).toBeDefined();
    if(createdChunk) {
        expect(createdChunk.x).toBe(0);
        expect(createdChunk.z).toBe(0);
    }
    expect(typeof val).toBe('number');
    expect(val).toBe(5); // Check if the mock genChunk put the correct value
  });

  it('returns existing chunk data if chunk already present', () => {
    // First access: generate chunk (0,0)
    getBlock(state, state.seed, 10, 60, 10); 
    expect(state.chunks.size).toBe(1);
    const initialChunkDataLength = state.chunks.get('0,0')?.data.length;

    // Second access to the same chunk (0,0) but different world coords
    const val = getBlock(state, state.seed, 15, 65, 15);
    expect(state.chunks.size).toBe(1); // No new chunk should be created
    expect(state.chunks.get('0,0')?.data.length).toBe(initialChunkDataLength);
    expect(typeof val).toBe('number'); 
    expect(val).toBe(1); // Mock fills with 1
  });
}); 