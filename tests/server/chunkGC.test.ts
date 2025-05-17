import * as RAPIER from '@dimforge/rapier3d-compat';
import { World } from '@dimforge/rapier3d-compat'; // Direct import for constructor
import { genChunk } from '../../src/server/world/genChunk.js';
import { buildChunkColliders } from '../../src/server/physics/buildChunkColliders.js';
import { sweepInactiveChunks } from '../../src/server/world/chunkGC.js';
import type { MatchState, Chunk as ServerChunk, Player, PhysicsWorld } from '../../src/server/types.js';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, BLOCK_AIR } from '../../src/shared/constants.js';

// Helper to drain all pending collider operations and step world (for testing)
async function drainAllColliderOperations(state: MatchState, world: RAPIER.World) {
  // console.log(`[Test/DrainAll] Before drain, queue size: ${state.pendingColliders.length}`);
  while (state.pendingColliders.length > 0) {
    const fn = state.pendingColliders.shift();
    if (fn) {
      fn();
    }
  }
  // console.log(`[Test/DrainAll] After drain, queue size: ${state.pendingColliders.length}`);
  world.step(); // Step world once after processing all
}

describe('Chunk Garbage Collection (sweepInactiveChunks)', () => {
  let world: RAPIER.World;
  let mockMatchState: MatchState;

  beforeAll(async () => {
    await RAPIER.init();
  });

  beforeEach(() => {
    world = new World({ x: 0, y: -9.81, z: 0 }); // Use new World()
    mockMatchState = {
      players: new Map<string, Player>(),
      chunks: new Map<string, ServerChunk>(),
      lastUpdate: 0,
      seed: 1,
      physicsWorld: {
        raw: world,
        step: () => world.step(),
        addRigidBody: (desc: RAPIER.RigidBodyDesc) => world.createRigidBody(desc),
        removeRigidBody: (body: RAPIER.RigidBody) => world.removeRigidBody(body),
        addCollider: (desc: RAPIER.ColliderDesc) => {
          return world.createCollider(desc);
        },
        removeCollider: (collider: RAPIER.Collider) => {
          world.removeCollider(collider, true);
        }
      } as PhysicsWorld, // Cast to PhysicsWorld
      pendingColliders: [],
    };
  });

  it('removes colliders and chunk when no players are present', async () => {
    const cx = 10;
    const cz = 10;
    const chunkData = genChunk(mockMatchState.seed, cx, cz);
    const testChunk: ServerChunk = { 
        x: cx, z: cz, data: chunkData.voxels, lastModified: Date.now(), colliderHandles: [] 
    };
    mockMatchState.chunks.set(`${cx},${cz}`, testChunk);

    // Enqueue initial colliders
    buildChunkColliders(world, testChunk, chunkData.voxels, cx, cz, mockMatchState);
    // Drain the queue to actually create them and populate handles
    await drainAllColliderOperations(mockMatchState, world);
    
    expect(testChunk.colliderHandles && testChunk.colliderHandles.length > 0).toBe(true);
    const initialHandleCount = testChunk.colliderHandles?.length || 0;

    // No players -> chunk should be GC'd
    const gcResult = sweepInactiveChunks(world, mockMatchState);
    expect(gcResult.removedChunkCount).toBe(1);
    expect(gcResult.removedColliderCount).toBe(initialHandleCount);
    expect(mockMatchState.pendingColliders.length).toBe(initialHandleCount); // Removals are queued

    await drainAllColliderOperations(mockMatchState, world); // Run queued removals

    expect(mockMatchState.chunks.has(`${cx},${cz}`)).toBe(false);
    expect(testChunk.colliderHandles?.length).toBe(0); // Handles should be cleared by removeChunkColliders
     // Optionally, check if colliders are truly gone from Rapier world (more complex)
  });

  it('keeps chunk if a player is nearby', async () => {
    const cx = 5;
    const cz = 5;
    const chunkData = genChunk(mockMatchState.seed, cx, cz);
    const testChunk: ServerChunk = { 
        x: cx, z: cz, data: chunkData.voxels, lastModified: Date.now(), colliderHandles: []
    };
    mockMatchState.chunks.set(`${cx},${cz}`, testChunk);
    buildChunkColliders(world, testChunk, chunkData.voxels, cx, cz, mockMatchState);
    await drainAllColliderOperations(mockMatchState, world);

    // Add a player near the chunk center
    const playerX = (cx + 0.5) * CHUNK_SIZE_X;
    const playerZ = (cz + 0.5) * CHUNK_SIZE_Z;
    const player: Player = { id: 'player1', entityId:1, position: { x: playerX, y: 70, z: playerZ }, rotation: {x:0,y:0,z:0}, velocity:{x:0,y:0,z:0} };
    mockMatchState.players.set(player.id, player);

    const gcResult = sweepInactiveChunks(world, mockMatchState);
    expect(gcResult.removedChunkCount).toBe(0);
    expect(gcResult.removedColliderCount).toBe(0);
    expect(mockMatchState.chunks.has(`${cx},${cz}`)).toBe(true);
    expect(mockMatchState.pendingColliders.length).toBe(0); // No removal operations queued
  });

  it('removes chunk if player moves far away', async () => {
    const cx = 2;
    const cz = 2;
    const chunkData = genChunk(mockMatchState.seed, cx, cz);
    const testChunk: ServerChunk = { 
        x: cx, z: cz, data: chunkData.voxels, lastModified: Date.now(), colliderHandles: [] 
    };
    mockMatchState.chunks.set(`${cx},${cz}`, testChunk);
    buildChunkColliders(world, testChunk, chunkData.voxels, cx, cz, mockMatchState);
    await drainAllColliderOperations(mockMatchState, world);
    const initialHandleCount = testChunk.colliderHandles?.length || 0;

    // Player initially near
    const player: Player = { id: 'player1', entityId:1, position: { x: (cx + 0.5) * CHUNK_SIZE_X, y: 70, z: (cz + 0.5) * CHUNK_SIZE_Z }, rotation: {x:0,y:0,z:0}, velocity:{x:0,y:0,z:0} };
    mockMatchState.players.set(player.id, player);

    let gcResult = sweepInactiveChunks(world, mockMatchState);
    expect(gcResult.removedChunkCount).toBe(0); // Should not be GC'd yet

    // Move player far away
    player.position.x += 200 * CHUNK_SIZE_X; // Move far away
    gcResult = sweepInactiveChunks(world, mockMatchState);
    expect(gcResult.removedChunkCount).toBe(1);
    expect(gcResult.removedColliderCount).toBe(initialHandleCount);
    
    await drainAllColliderOperations(mockMatchState, world); // Process removals
    expect(mockMatchState.chunks.has(`${cx},${cz}`)).toBe(false);
  });
}); 