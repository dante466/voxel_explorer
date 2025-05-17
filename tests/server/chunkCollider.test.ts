import * as RAPIER from '@dimforge/rapier3d-compat';
import { genChunk } from '../../src/server/world/genChunk.js';
import { buildChunkColliders } from '../../src/server/physics/buildChunkColliders.js';
import { CHUNK_SIZE_Y, BLOCK_AIR, CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../../src/shared/constants.js'; // Import constants
import type { MatchState, Chunk as ServerChunk } from '../../src/server/types.js';

describe('buildChunkColliders (column strategy with queuing)', () => {
  let world: RAPIER.World;
  let mockMatchState: MatchState;

  beforeAll(async () => {
    await RAPIER.init();
  });

  beforeEach(() => {
    world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    mockMatchState = {
      players: new Map(),
      chunks: new Map(),
      lastUpdate: 0,
      seed: 0,
      physicsWorld: { raw: world, step: () => {} }, // Mock physicsWorld with the raw world
      pendingColliders: [],
      // ecsWorld is not used by buildChunkColliders, so a minimal mock or undefined might be acceptable if types allow
    } as unknown as MatchState; // Cast needed if ecsWorld is strictly required by type but not used by tested func
  });

  it('queues one collider per solid column and populates handles when closures are run', () => {
    const cx = 0;
    const cz = 0;
    const chunkData = genChunk(0, cx, cz); // Seed 0 for potentially simpler terrain
    const testChunk: ServerChunk = {
      x: cx, z: cz, data: chunkData.voxels, lastModified: Date.now(), colliderHandles: []
    };

    const enqueuedCount = buildChunkColliders(world, testChunk, chunkData.voxels, cx, cz, mockMatchState);

    let expectedColumnCount = 0;
    const area = CHUNK_SIZE_X * CHUNK_SIZE_Z;
    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        let columnHasSolidBlock = false;
        for (let y = 0; y < CHUNK_SIZE_Y; y++) {
          const idx = y * area + z * CHUNK_SIZE_X + x;
          if (chunkData.voxels[idx] !== BLOCK_AIR) {
            columnHasSolidBlock = true;
            break;
          }
        }
        if (columnHasSolidBlock) {
          expectedColumnCount++;
        }
      }
    }

    expect(enqueuedCount).toBe(expectedColumnCount);
    expect(mockMatchState.pendingColliders.length).toBe(expectedColumnCount);

    // Execute the queued closures
    mockMatchState.pendingColliders.forEach(fn => fn());

    expect(testChunk.colliderHandles).toBeDefined();
    expect(testChunk.colliderHandles?.length).toBe(expectedColumnCount);
    // Further checks: ensure handles are valid (e.g., by trying to get collider from world using handle)
    if (testChunk.colliderHandles && testChunk.colliderHandles.length > 0) {
      const firstHandle = testChunk.colliderHandles[0];
      const collider = world.getCollider(firstHandle);
      expect(collider).not.toBeNull();
      expect(collider?.halfExtents().x).toBe(0.5); // Column colliders are 0.5 in x and z
      expect(collider?.halfExtents().z).toBe(0.5);
      // Height will vary per column
    }
  });

  it('queues CHUNK_SIZE_X * CHUNK_SIZE_Z colliders for a fully solid chunk (all columns solid)', () => {
    const cx = 1;
    const cz = 1;
    const numVoxels = CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z;
    const solidVoxels = new Uint8Array(numVoxels).fill(1); // All blocks solid (type 1)
    const testChunk: ServerChunk = {
      x: cx, z: cz, data: solidVoxels, lastModified: Date.now(), colliderHandles: []
    };

    const enqueuedCount = buildChunkColliders(world, testChunk, solidVoxels, cx, cz, mockMatchState);
    const expectedColumns = CHUNK_SIZE_X * CHUNK_SIZE_Z;

    expect(enqueuedCount).toBe(expectedColumns);
    expect(mockMatchState.pendingColliders.length).toBe(expectedColumns);

    // Execute the queued closures
    mockMatchState.pendingColliders.forEach(fn => fn());
    expect(testChunk.colliderHandles?.length).toBe(expectedColumns);
  });

  it('queues 0 colliders for a completely empty (all air) chunk', () => {
    const cx = 2;
    const cz = 2;
    const numVoxels = CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z;
    const airVoxels = new Uint8Array(numVoxels).fill(BLOCK_AIR);
    const testChunk: ServerChunk = {
      x: cx, z: cz, data: airVoxels, lastModified: Date.now(), colliderHandles: []
    };

    const enqueuedCount = buildChunkColliders(world, testChunk, airVoxels, cx, cz, mockMatchState);

    expect(enqueuedCount).toBe(0);
    expect(mockMatchState.pendingColliders.length).toBe(0);
    expect(testChunk.colliderHandles?.length).toBe(0);
  });
}); 