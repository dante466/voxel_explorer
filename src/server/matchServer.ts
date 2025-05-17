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
  };

  // S1-2: Pre-warm initial chunks
  /*
  console.log('[Server] S1-2: Pre-warming initial 3x3 chunks around (0,0)...');
  const s12_startTime = performance.now();
  let s12_chunksGenerated = 0;
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      try {
        const chunkData = genChunk(matchState.seed, cx, cz);
        const cKey = chunkKey(cx, cz); // Use chunkKey utility
        matchState.chunks.set(cKey, {
          x: cx,
          z: cz,
          data: chunkData.voxels,
          lastModified: chunkData.lastModified, // Assume lastModified is already a number
        });
        console.log(`[Server] S1-2: Generated chunk ${cKey}`);
        s12_chunksGenerated++;
      } catch (error) {
        console.error(`[Server] S1-2: Error generating chunk ${cx},${cz}:`, error);
      }
    }
  }
  const s12_endTime = performance.now();
  const s12_duration = s12_endTime - s12_startTime;
  console.log(`[Server] S1-2: Pre-warmed ${s12_chunksGenerated} chunks in ${s12_duration.toFixed(2)} ms.`);
  if (s12_chunksGenerated === 9 && s12_duration < 200) {
    console.log('[Server] S1-2 Success: Chunk pre-warming completed successfully and within 200ms.');
  } else if (s12_chunksGenerated === 9) {
    console.warn(`[Server] S1-2 Performance: Chunk pre-warming took ${s12_duration.toFixed(2)}ms (target < 200ms).`);
  } else {
    console.error('[Server] S1-2 Failed: Not all 9 chunks were generated.');
  }
  */
  // End S1-2 Pre-warming

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
  function handleMessage(ws: WebSocket, message: any, matchState: MatchState, wssInstance: WebSocketServer) {
    const cmdPlayerId = getPlayerIdForWebSocket(ws, matchState);
    console.log(`[Server] Received message:`, message, `from player: ${cmdPlayerId}`); // Log all incoming messages

    switch (message.commandType || message.type) {
      case 'playerUpdate':
        // TODO: Update player state and broadcast to other clients
        break;
      case 'chunkRequest': { // S1-3: Handle chunk request from client
        const { cx, cz, seq } = message; // Assume client sends cx, cz, and optional seq

        if (typeof cx !== 'number' || typeof cz !== 'number') {
          console.error(`[Server] Invalid chunkRequest: missing coordinates. cx=${cx}, cz=${cz}`);
          sendError(ws, 'chunkResponseError', seq, 'InvalidCoordinates', 'Missing chunk coordinates.');
          break;
        }

        // Validate chunk coordinates (optional, but good practice)
        // Example: Ensure they are within some reasonable bounds if your world is not infinite.
        // For now, we'll assume any integer coordinates are valid.

        console.log(`[Server] Chunk request for ${cx},${cz} from player ${cmdPlayerId}`);
        try {
          // getOrCreateChunk expects the main MatchState and the seed.
          const chunk = getOrCreateChunk(matchState, matchState.seed, cx, cz);

          if (chunk && chunk.data) {
            const chunkResponseMessage = {
              type: 'chunkResponse',
              cx: cx,
              cz: cz,
              voxels: Array.from(chunk.data), // Convert Uint8Array to number[] for JSON
              seq: seq // Echo back sequence number if provided
            };
            ws.send(JSON.stringify(chunkResponseMessage));
            console.log(`[Server] Sent chunk ${cx},${cz} to player ${cmdPlayerId}`);
          } else {
            // This case should ideally not be hit if getOrCreateChunk always returns a valid chunk or throws
            console.error(`[Server] Failed to get or create chunk ${cx},${cz}. Chunk or chunk.data is null/undefined.`);
            sendError(ws, 'chunkResponseError', seq, 'ChunkGenerationFailed', `Server failed to provide chunk ${cx},${cz}.`);
          }
        } catch (error) {
          console.error(`[Server] Error processing chunkRequest for ${cx},${cz}:`, error);
          sendError(ws, 'chunkResponseError', seq, 'InternalServerError', `Error processing chunk ${cx},${cz}.`);
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
        const success = setBlock(matchState, matchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ, 0);
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
        const currentBlock = getBlock(matchState, matchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ);
        if (currentBlock !== 0 && currentBlock !== null) { // Check if block is not air
            sendError(ws, 'placeError', seq, 'BlockOccupied', `Cannot place block at (${targetVoxelX},${targetVoxelY},${targetVoxelZ}), it's occupied by ${currentBlock}.`);
            break;
        }

        const success = setBlock(matchState, matchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ, blockIdToPlace);

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
  setInterval(() => {
    const now = Date.now();
    const delta = now - matchState.lastUpdate;
    matchState.ecsWorld.time.delta = delta / 1000; // Convert ms to seconds
    matchState.ecsWorld.time.elapsed += delta;
    matchState.ecsWorld.time.then = now;
    
    physicsWorld.step();
    
    matchState.lastUpdate = now;
    
    broadcastState(wss, matchState);
  }, TICK_RATE);

  // Broadcast state to all connected clients
  function broadcastState(wssInstance: WebSocketServer, matchState: MatchState) {
    const stateUpdatePayload = {
      type: 'stateUpdate',
      state: { 
          players: Object.fromEntries(matchState.players),
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