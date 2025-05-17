import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { addEntity, addComponent, removeEntity } from 'bitecs';
import { createServerECSWorld, Position, Rotation, Velocity, NetworkId, type ServerECSWorld } from './ecs/world.js';
import { createPhysicsWorld, initRapier } from './physics.js';
import type { MatchState as IMatchState, Player, Chunk } from './types.js'; // Renamed to avoid conflict
import { ClientCommandType } from './types.js';
import { encodeChunkDiff, type VoxelChange } from '../world/encodeChunkDiff.js';
import { genChunk } from './world/genChunk.js'; // S1-2: Import genChunk
import { testS1_1_HeightmapConsistency } from './world/chunkValidation.js'; // S1-1 Test
import { getBlock, setBlock } from './world/voxelIO.js'; // Import from new location
import { chunkKey } from './world/chunkUtils.js'; // For pre-warming key gen
import { getOrCreateChunk } from './world/getOrCreateChunk.js'; // Corrected import path
import { buildChunkColliders } from './physics/buildChunkColliders.js'; // S2-1 Import
import { sweepInactiveChunks } from './world/chunkGC.js'; // S2-2 Import sweepInactiveChunks

const app = express();
const port = process.env.PORT || 3000;

// Server-side constants for world/chunk structure
// Assuming same as client for now. These should ideally be shared or configured.
const CHUNK_SIZE_X = 32;
const CHUNK_SIZE_Y = 128; // Max height
const CHUNK_SIZE_Z = 32;

// World boundaries for mining validation (example values)
const WORLD_MIN_X = -512;
const WORLD_MAX_X = 512;
const WORLD_MIN_Y = 0;
const WORLD_MAX_Y = CHUNK_SIZE_Y -1;
const WORLD_MIN_Z = -512;
const WORLD_MAX_Z = 512;

const DEFAULT_WORLD_SEED = 12345;

// Updated MatchState interface to include ecsWorld
interface MatchState extends IMatchState {
  ecsWorld: ServerECSWorld;
  seed: number;
  physicsWorld: ReturnType<typeof createPhysicsWorld>;
  pendingColliders: (() => void)[];
}

const matchStateStore = new Map<string, MatchState>();

// Helper function to send standardized error messages
function sendError(ws: WebSocket, errorType: string, seq: number | undefined, errorCode: string, reason: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: errorType,
      seq: seq,
      code: errorCode,
      reason: reason
    }));
  }
}

// Initialize server
async function startServer() {
  // Initialize Rapier first
  await initRapier();
  
  // S1-1 Test: Run heightmap consistency check
  // We need genChunk to be available here. Assuming it's imported correctly.
  // The test function is async, so we await it.
  try {
    const s1_1_seed = DEFAULT_WORLD_SEED; // Use the same seed as S1-2 for this test
    console.log(`[Server] S1-1: Running genChunk heightmap consistency test with seed ${s1_1_seed}...`);
    const s1_1_test_passed = await testS1_1_HeightmapConsistency(genChunk, s1_1_seed);
    if (s1_1_test_passed) {
      console.log('[Server] S1-1: Heightmap consistency test PASSED.');
    } else {
      console.error('[Server] S1-1: Heightmap consistency test FAILED. Check logs from chunkValidation.');
    }
  } catch (e) {
    console.error('[Server] S1-1: Error during heightmap consistency test execution:', e);
  }
  // End S1-1 Test

  // Create HTTP server
  const server = app.listen(port, () => {
    console.log(`Match server running on port ${port}`);
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server });

  // Initialize ECS World
  const ecsWorld = createServerECSWorld();

  // Initialize physics world
  const physicsWorld = createPhysicsWorld();

  // Game state
  const matchState: MatchState = {
    players: new Map(),
    chunks: new Map(),
    lastUpdate: Date.now(),
    ecsWorld: ecsWorld, // Add ecsWorld to matchState
    seed: DEFAULT_WORLD_SEED, // Initialize seed in matchState
    physicsWorld: physicsWorld, // Assign physicsWorld
    pendingColliders: [], // Initialize pendingColliders
  };

  // S1-2 & S2-1: Pre-warm initial 3x3 chunk area and queue colliders
  console.log('[Server/Pre-warm] Pre-warming 3x3 chunk area around (0,0) and queueing colliders...');
  const s12_startTime = performance.now();
  let s12_chunksProcessed = 0; // Renamed from s12_chunksGenerated
  let totalCollidersQueued = 0; // Changed from totalCollidersCreated

  const preWarmRadius = 1; // For a 3x3 area (-1 to 1)
  const preWarmPromises: Promise<void>[] = []; // Changed to Promise<void> as getOrCreateChunk might not need to return chunk for this specific summing purpose if count is handled differently

  for (let cx = -preWarmRadius; cx <= preWarmRadius; cx++) {
    for (let cz = -preWarmRadius; cz <= preWarmRadius; cz++) {
      preWarmPromises.push(
        getOrCreateChunk(matchState, matchState.seed, cx, cz)
          .then(chunk => { // chunk is still returned by getOrCreateChunk
            if (chunk) {
              s12_chunksProcessed++;
              // The count of colliders is now determined by buildChunkColliders' return or inspection of pendingColliders queue length change
              // For simplicity in pre-warm, we assume getOrCreateChunk correctly triggers buildChunkColliders,
              // which in turn populates pendingColliders. We'll log the queue size after all calls.
              console.log(`[Server/Pre-warm] Chunk (${cx},${cz}) processed for collider queuing.`);
            } else {
              console.error(`[Server/Pre-warm] Failed to get or create chunk (${cx},${cz}) during pre-warm.`);
            }
          })
          .catch(error => {
            console.error(`[Server/Pre-warm] Error processing chunk (${cx},${cz}) for collider queuing:`, error);
          })
      );
    }
  }

  // Wait for all chunk generation and collider queuing to be initiated
  await Promise.all(preWarmPromises);
  
  totalCollidersQueued = matchState.pendingColliders.length; // Get total from the queue itself

  const s12_endTime = performance.now();
  const s12_duration = s12_endTime - s12_startTime;
  console.log(`[Server/Pre-warm] Finished processing ${s12_chunksProcessed} chunk(s) for collider queuing in ${s12_duration.toFixed(2)} ms.`);
  console.log(`[Physics] Queued ${totalCollidersQueued} terrain colliders during pre-warm.`); // Updated log

  if (s12_chunksProcessed === (preWarmRadius * 2 + 1) ** 2) {
    console.log('[Server/Pre-warm] Success: All expected initial chunks processed for queuing.');
  } else {
    console.warn(`[Server/Pre-warm] Warning: Expected ${(preWarmRadius * 2 + 1) ** 2} chunks for queuing, but processed ${s12_chunksProcessed}.`);
  }
  // End S1-2 & S2-1 Pre-warming

  let nextPlayerNumericId = 1; // For ECS NetworkId

  // WebSocket connection handler
  wss.on('connection', (ws) => {
    const playerIdString = `player${nextPlayerNumericId}`;
    const playerNumericId = nextPlayerNumericId++; // Use current value for ID, then increment
    console.log(`New client connected. Assigned ID: ${playerIdString} (Numeric: ${playerNumericId})`);

    // Create ECS entity for the player
    const playerEntityId = addEntity(matchState.ecsWorld);

    const newPlayer: Player = {
      id: playerIdString,
      entityId: playerEntityId, // Store ECS entity ID
      position: { x: 0, y: 70, z: 0 }, // Default spawn position
      rotation: { x: 0, y: 0, z: 0 }, // Default spawn rotation
      velocity: { x: 0, y: 0, z: 0 },
      ws: ws, 
      lastProcessedInputSeq: 0
    };
    matchState.players.set(playerIdString, newPlayer);

    // Add components to the ECS entity
    addComponent(matchState.ecsWorld, Position, playerEntityId);
    Position.x[playerEntityId] = newPlayer.position.x;
    Position.y[playerEntityId] = newPlayer.position.y;
    Position.z[playerEntityId] = newPlayer.position.z;

    addComponent(matchState.ecsWorld, Rotation, playerEntityId);
    Rotation.x[playerEntityId] = newPlayer.rotation.x;
    Rotation.y[playerEntityId] = newPlayer.rotation.y;
    Rotation.z[playerEntityId] = newPlayer.rotation.z;

    addComponent(matchState.ecsWorld, Velocity, playerEntityId);
    Velocity.vx[playerEntityId] = newPlayer.velocity.x;
    Velocity.vy[playerEntityId] = newPlayer.velocity.y;
    Velocity.vz[playerEntityId] = newPlayer.velocity.z;

    addComponent(matchState.ecsWorld, NetworkId, playerEntityId);
    NetworkId.id[playerEntityId] = playerNumericId;

    console.log(`[ECS] Created entity ${playerEntityId} for player ${playerIdString} (NetworkId: ${playerNumericId})`);

    // Send initial state (now includes the new player)
    ws.send(JSON.stringify({
      type: 'init',
      playerId: playerIdString, // Send the client its ID
      state: { players: Object.fromEntries(matchState.players) } // Send initial player list
    }));

    // Handle incoming messages
    ws.on('message', (data) => {
      const rawData = data.toString(); 
      console.log(`[Server] Raw data received: ${rawData}`); 

      try {
        const message = JSON.parse(rawData);
        console.log(`[Server] Parsed message object:`, message); 

        handleMessage(ws, message, matchState, wss);
      } catch (error) {
        console.error('[Server] JSON Parse Error or error in handleMessage:', error); 
        console.error('[Server] Offending raw data for parse error:', rawData); 
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log(`Client ${playerIdString} disconnected`);
      const player = matchState.players.get(playerIdString);
      if (player) {
        console.log(`[ECS] Removing entity ${player.entityId} for player ${playerIdString}`);
        removeEntity(matchState.ecsWorld, player.entityId);
        matchState.players.delete(playerIdString); // Clean up player state
      } else {
        console.warn(`Player ${playerIdString} not found in matchState on disconnect.`);
      }
      // Optionally, broadcast player disconnect if other clients need to know
    });
  });

  // Message handler
  // NOW ASYNC to handle await for getOrCreateChunk
  async function handleMessage(ws: WebSocket, message: any, matchState: MatchState, wssInstance: WebSocketServer) {
    const cmdPlayerId = getPlayerIdForWebSocket(ws, matchState);
    console.log(`[Server] Received message:`, message, `from player: ${cmdPlayerId}`); // Log all incoming messages

    switch (message.commandType || message.type) {
      case 'playerUpdate':
        // TODO: Update player state and broadcast to other clients
        break;
      case 'chunkRequest': { // S1-3: Handle chunk request from client
        const { cx, cz, seq } = message; // Assume client sends cx, cz, and optional seq

        if (typeof cx !== 'number' || typeof cz !== 'number') {
          console.error(`[Server] Invalid chunkRequest: cx or cz missing or not numbers.`, message);
          // Use the generic sendError helper if applicable, or craft specific response
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'chunkResponseError',
              seq: seq, // Include seq if client sent it
              // cx and cz are not known/valid here, so cannot include them
              code: 'BadRequest',
              reason: 'Invalid chunkRequest: cx and/or cz missing or not numbers.'
            }));
          }
          return;
        }

        try {
          console.log(`[Server/chunkRequest] Processing ASYNC chunkRequest for ${cx},${cz}`);
          const chunk = await getOrCreateChunk(matchState, matchState.seed, cx, cz); // Await the async function
          // Convert Uint8Array to a regular array for JSON serialization
          const voxelsArray = Array.from(chunk.data);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'chunkResponse',
              cx: cx,
              cz: cz,
              voxels: voxelsArray,
              // lodLevel: chunk.lodLevel // Future: if server sends LOD specific data
            }));
            console.log(`[Server] Sent chunkResponse for ${cx},${cz} with ${voxelsArray.length} voxels.`);
          }
        } catch (error) {
          console.error(`[Server] Error processing chunk request for ${cx},${cz}:`, error);
          // Ensure cx and cz are included in the error response for client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'chunkResponseError',
              seq: seq, // Include seq if client sent it
              cx: cx,   // Ensure cx is included
              cz: cz,   // Ensure cz is included
              code: 'InternalServerError',
              reason: `Error processing chunk ${cx},${cz}. Details: ${(error instanceof Error) ? error.message : String(error)}`
            }));
          }
        }
        break;
      }
      case ClientCommandType.PLAYER_INPUT:
        if (cmdPlayerId) {
          const player = matchState.players.get(cmdPlayerId);
          if (player && message.seq !== undefined) {
            player.lastProcessedInputSeq = message.seq;
            
            // Log PLAYER_INPUT only if there's actual movement or mouse input to reduce spam
            const hasMovement = message.actions && 
                                (message.actions.moveForward || message.actions.moveBackward || 
                                 message.actions.moveLeft || message.actions.moveRight || 
                                 message.actions.jump || message.actions.descend);
            const hasMouseMovement = message.mouseDeltaX !== 0 || message.mouseDeltaY !== 0;

            /* Commenting out to reduce console spam
            if (hasMovement || hasMouseMovement) {
              console.log(`[Server] PLAYER_INPUT from ${cmdPlayerId} (seq: ${message.seq}): Actions:`, message.actions, `Mouse: dx=${message.mouseDeltaX}, dy=${message.mouseDeltaY}`);
            }
            */

            // Update player position/rotation based on input (simplified example)
            if (message.actions) {
                // Example: Crude movement update, replace with physics integration
                const speed = 0.5; // units per input message processing
                if(message.actions.moveForward) player.position.z -= speed;
                if(message.actions.moveBackward) player.position.z += speed;
                if(message.actions.moveLeft) player.position.x -= speed;
                if(message.actions.moveRight) player.position.x += speed;
            }
            // TODO: Incorporate mouseDeltaX/Y for rotation updates if applicable server-side
          } else {
            // console.warn(`PlayerInput for ${cmdPlayerId} missing seq or player not found.`);
          }
        }
        break;
      case ClientCommandType.MINE_BLOCK: {
        console.log(`MINE_BLOCK case entered for player ${cmdPlayerId}. Message:`, message);
        const { targetVoxelX, targetVoxelY, targetVoxelZ, seq } = message;

        if (typeof targetVoxelX !== 'number' || typeof targetVoxelY !== 'number' || typeof targetVoxelZ !== 'number') {
          console.error('Invalid MINE_BLOCK command: missing target coordinates.');
          sendError(ws, 'mineError', seq, 'InvalidCoordinates', 'Missing target voxel coordinates.');
          break;
        }
        console.log(`Processing MINE_BLOCK for ${targetVoxelX},${targetVoxelY},${targetVoxelZ}`);
        console.log('Validating MINE_BLOCK...');
        // Basic AABB validation (ensure it's within the conceptual world limits)
        if (targetVoxelX < WORLD_MIN_X || targetVoxelX > WORLD_MAX_X ||
            targetVoxelY < WORLD_MIN_Y || targetVoxelY > WORLD_MAX_Y ||
            targetVoxelZ < WORLD_MIN_Z || targetVoxelZ > WORLD_MAX_Z) {
          console.warn(`MINE_BLOCK for ${cmdPlayerId} denied: out of bounds (${targetVoxelX},${targetVoxelY},${targetVoxelZ}).`);
          sendError(ws, 'mineError', seq, 'OutOfBounds', 'Target voxel is out of world bounds.');
          break;
        }
        console.log('MINE_BLOCK validation passed.');

        // TODO: Add more validation (e.g., distance to player, line of sight)

        console.log(`Calling server setBlock(${targetVoxelX},${targetVoxelY},${targetVoxelZ}, 0)`);
        const success = await setBlock(matchState, matchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ, 0);
        console.log(`server setBlock success: ${success}`);

        if (success) {
          const chunkX = Math.floor(targetVoxelX / CHUNK_SIZE_X);
          const chunkZ = Math.floor(targetVoxelZ / CHUNK_SIZE_Z);
          const localX = ((targetVoxelX % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
          const localY = targetVoxelY;
          const localZ = ((targetVoxelZ % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;

          const voxelFlatIndex = localY * (CHUNK_SIZE_X * CHUNK_SIZE_Z) + localZ * CHUNK_SIZE_X + localX;
          
          const changes: VoxelChange[] = [{ voxelFlatIndex, newBlockId: 0 }]; // 0 for mined block (air)
          const rleBytes = encodeChunkDiff(changes);

          const blockUpdateMessage = {
            type: 'blockUpdate',
            chunkX: chunkX,
            chunkZ: chunkZ,
            rleBytes: Array.from(rleBytes) // Convert Uint8Array to array for JSON
          };
          console.log('[Server] Broadcasting blockUpdateMessage (RLE):', blockUpdateMessage);
          wssInstance.clients.forEach((client: WebSocket) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(blockUpdateMessage));
            }
          });
        } else {
          // This case might occur if setBlock itself has internal validation that fails
          // or if the block was already air (though setBlock might return true for that)
          sendError(ws, 'mineError', seq, 'SetBlockFailed', 'Server failed to set block or no change.');
        }
        break;
      }
      case ClientCommandType.PLACE_BLOCK: {
        const { targetVoxelX, targetVoxelY, targetVoxelZ, blockId, seq } = message;
        const blockIdToPlace = blockId; // blockId from message

        if (typeof targetVoxelX !== 'number' || typeof targetVoxelY !== 'number' || typeof targetVoxelZ !== 'number' || typeof blockIdToPlace !== 'number') {
            sendError(ws, 'placeError', seq, 'InvalidParameters', 'Missing or invalid parameters for PLACE_BLOCK.');
            break;
        }
        
        // Basic AABB validation
        if (targetVoxelX < WORLD_MIN_X || targetVoxelX > WORLD_MAX_X ||
            targetVoxelY < WORLD_MIN_Y || targetVoxelY > WORLD_MAX_Y ||
            targetVoxelZ < WORLD_MIN_Z || targetVoxelZ > WORLD_MAX_Z) {
            sendError(ws, 'placeError', seq, 'OutOfBounds', 'Target voxel is out of world bounds.');
            break;
        }

        // Validate blockIdToPlace (e.g., not air, within valid range)
        if (blockIdToPlace <= 0) { // Assuming 0 is air and non-placeable
            sendError(ws, 'placeError', seq, 'InvalidBlockID', 'Cannot place air or invalid block ID.');
            break;
        }
        
        // TODO: Add more validation (distance to player, ensure target is air/replaceable)
        // For now, let's assume we can only place in air blocks (getBlock should return 0 or null)
        const currentBlock = await getBlock(matchState, matchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ);
        if (currentBlock !== 0 && currentBlock !== null) { // Check if block is not air
            sendError(ws, 'placeError', seq, 'BlockOccupied', `Cannot place block at (${targetVoxelX},${targetVoxelY},${targetVoxelZ}), it's occupied by ${currentBlock}.`);
            break;
        }

        const success = await setBlock(matchState, matchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ, blockIdToPlace);

        if (success) {
            const chunkX = Math.floor(targetVoxelX / CHUNK_SIZE_X);
            const chunkZ = Math.floor(targetVoxelZ / CHUNK_SIZE_Z);
            const localX = ((targetVoxelX % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
            const localY = targetVoxelY;
            const localZ = ((targetVoxelZ % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;

            const voxelFlatIndex = localY * (CHUNK_SIZE_X * CHUNK_SIZE_Z) + localZ * CHUNK_SIZE_X + localX;
            
            const changes: VoxelChange[] = [{ voxelFlatIndex, newBlockId: blockIdToPlace }];
            const rleBytes = encodeChunkDiff(changes);

            const blockUpdateMessage = {
                type: 'blockUpdate',
                chunkX: chunkX,
                chunkZ: chunkZ,
                rleBytes: Array.from(rleBytes) // Convert Uint8Array to array for JSON
            };
            console.log('[Server] Broadcasting blockUpdateMessage (RLE):', blockUpdateMessage);
            wssInstance.clients.forEach((client: WebSocket) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(blockUpdateMessage));
                }
            });
        } else {
            sendError(ws, 'placeError', seq, 'SetBlockFailed', 'Server failed to place block.');
        }
        break;
      }
      case 'clientCommand':
        if (cmdPlayerId) {
          const player = matchState.players.get(cmdPlayerId);
          if (player && message.seq !== undefined) {
            player.lastProcessedInputSeq = message.seq;
          }
        }
        break;
      default:
        console.warn(`Unknown command/message type: '${message.commandType || message.type}' from player ${cmdPlayerId}`);
    }
  }

  // Helper function
  function getPlayerIdForWebSocket(ws: WebSocket, matchState: MatchState): string | null {
    for (const [id, player] of matchState.players.entries()) {
      if (player.ws === ws) {
        return id;
      }
    }
    return null;
  }

  // Game loop
  const TICK_RATE = 1000 / 30;
  const MAX_COLLIDERS_PER_TICK = 2000; // Max colliders to create per game tick
  let gcTimer = 0; // S2-2 GC Timer
  const GC_INTERVAL_TICKS = 150; // Every 5 seconds at 30Hz (150 ticks)

  setInterval(() => {
    const now = Date.now();
    const delta = now - matchState.lastUpdate;
    matchState.ecsWorld.time.delta = delta / 1000; // Convert ms to seconds
    matchState.ecsWorld.time.elapsed += delta;
    matchState.ecsWorld.time.then = now;

    // 1. Process pending collider additions
    const collidersToProcessThisTick = Math.min(matchState.pendingColliders.length, MAX_COLLIDERS_PER_TICK);
    if (collidersToProcessThisTick > 0) {
      console.log(`[Physics/Tick] Draining ${collidersToProcessThisTick} colliders. Queue size: ${matchState.pendingColliders.length}`);
    }
    for (let i = 0; i < collidersToProcessThisTick; i++) {
      const colliderFunc = matchState.pendingColliders.shift(); // Use shift to process FIFO
      if (colliderFunc) {
        try {
          colliderFunc();
        } catch (e) {
          console.error('[Physics/Tick] Error executing collider function from queue:', e);
        }
      }
    }
    if (collidersToProcessThisTick > 0 && matchState.pendingColliders.length === 0) {
        console.log('[Physics/Tick] Collider queue drained.');
    }
    
    // 2. Step physics safely
    if (matchState.physicsWorld && matchState.physicsWorld.raw) {
      matchState.physicsWorld.raw.step();
    } else {
      // console.warn('[Physics/Tick] Physics world not available for step.');
    }
    
    // 3. Broadcast state
    broadcastState(wss, matchState);

    // 4. Chunk Garbage Collection (S2-2)
    if ((gcTimer += 1) >= GC_INTERVAL_TICKS) { 
      if (matchState.physicsWorld && matchState.physicsWorld.raw) {
        // console.log('[Server/Tick] Running chunk GC sweep...');
        sweepInactiveChunks(matchState.physicsWorld.raw, matchState /*, matchState.seed // Seed not used by sweep */);
      } else {
        console.warn('[Server/Tick] Cannot run chunk GC: physics world not available.');
      }
      gcTimer = 0;
    }

    matchState.lastUpdate = now;
  }, TICK_RATE);

  // Broadcast state to all connected clients
  function broadcastState(wssInstance: WebSocketServer, matchState: MatchState) {
    const stateUpdatePayload = {
      type: 'stateUpdate',
      state: { 
          players: Object.fromEntries(matchState.players.entries()),
          // Do not send full chunk data in regular state updates unless necessary
      }
    };
    wssInstance.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(stateUpdatePayload));
      }
    });
  }
}

// Start the server
startServer().catch(console.error); 