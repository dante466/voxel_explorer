import express from 'express';
import { WebSocketServer, WebSocket as ServerWebSocket } from 'ws';
import { addEntity, addComponent, removeEntity } from 'bitecs';
import { createServerECSWorld, Position, Rotation, Velocity, NetworkId, type ServerECSWorld } from './ecs/world.js';
import { createPhysicsWorld, initRapier } from './physics.js';
import type { MatchState as IMatchState, PlayerServer, Chunk } from './types.js'; // Renamed to avoid conflict
import { ClientCommandType } from './types.js';
import { encodeChunkDiff, type VoxelChange } from '../world/encodeChunkDiff.js';
import { genChunk } from './world/genChunk.js'; // S1-2: Import genChunk
import { testS1_1_HeightmapConsistency, type ServerGenChunkResult } from './world/chunkValidation.js'; // S1-1 Test, import type
import { getBlock, setBlock } from './world/voxelIO.js'; // Import from new location
import { chunkKey } from './world/chunkUtils.js'; // For pre-warming key gen
import { getOrCreateChunk } from './world/getOrCreateChunk.js'; // Corrected import path
import { buildChunkColliders } from './physics/buildChunkColliders.js'; // S2-1 Import
import { sweepInactiveChunks } from './world/chunkGC.js'; // S2-2 Import sweepInactiveChunks
import { createPlayerBody, removePlayerPhysicsBody, PLAYER_HEIGHT } from './physics/playerFactory.js'; // S3-2 Import, Added PLAYER_HEIGHT
import { nanoid } from 'nanoid'; // S3-2 Import
import { ByteBuffer } from 'flatbuffers'; // S3-3 Import for FlatBuffers
import { GameSchema } from '../generated/flatbuffers/game.js'; // S3-3 Corrected Import Path for FlatBuffers generated code
// Corrected destructuring to use PlayerInput as per current schema
const { PlayerInput, PlayerState } = GameSchema; 
import { MAX_SPEED, ACCEL, DECEL, YAW_RATE, GROUND_DAMP, AIR_DAMP } from './physics/movementConsts.js'; // S3-3 Import
import * as RAPIER from '@dimforge/rapier3d-compat'; // S3-3: Ensure RAPIER is imported for Vec3/Rotation types
import * as THREE from 'three'; // Import THREE for math operations
import { Builder as FlatbuffersBuilder } from 'flatbuffers'; // S3-4 For StateSnapshot broadcast
import { encodeServerSnapshot, type PlayerData } from '../net/flat.js'; // S3-4 Helper to encode StateSnapshot, renamed, and import PlayerData
import { PLAYER_SPAWN_POS, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, BLOCK_AIR, LODLevel } from '../shared/constants'; // S3-2, Added LODLevel
import { ChunkGenerationQueue } from './world/chunkGenerationQueue.js'; // Added import

const app = express();
const port = process.env.PORT || 3000;

// Server-side constants for world/chunk structure
// Assuming same as client for now. These should ideally be shared or configured.
const WORLD_MIN_X = -512;
const WORLD_MAX_X = 512;
const WORLD_MIN_Y = 0;
const WORLD_MAX_Y = CHUNK_SIZE_Y -1;
const WORLD_MIN_Z = -512;
const WORLD_MAX_Z = 512;

const DEFAULT_WORLD_SEED = 12345;
const MAX_CLIENTS = 10; // Defined MAX_CLIENTS
const TICK_RATE_MS = 1000 / 30; // Game tick rate in milliseconds
const GC_INTERVAL_TICKS = 1800; // Approx every 60 seconds (30 ticks/sec * 60 sec)
const MAX_COLLIDERS_PER_TICK = 1024; // Process more colliders to speed up initial load
const MAX_COLLIDER_REMOVALS_PER_TICK = 50; // New: Max direct collider removals per tick
const INITIAL_CHUNK_RADIUS = 1; // For a 3x3 area (center + 1 out)
const SERVER_FLYING_SPEED = 10.0; // Matches client PLAYER_SPEED_FLYING for C2-1 check

// Updated MatchState interface to include ecsWorld
interface MatchState extends IMatchState {
  ecsWorld: ServerECSWorld;
  seed: number;
  physicsWorld: ReturnType<typeof createPhysicsWorld>;
  pendingColliders: (() => void)[];
  handlesPendingRemoval: number[];
  playersAwaitingFullInit: PlayerServer[];
  initialServerLoadComplete: boolean;
  expectedInitialColliders: number; // For tracking initial collider processing
  initialCollidersProcessedCount: number; // Counter for processed initial colliders
  currentTick: number; // Added for server snapshot tick
  chunkGenQueue: ChunkGenerationQueue; // Added chunkGenQueue to MatchState
}

const matchStateStore = new Map<string, MatchState>();

// Helper function to send standardized error messages
function sendError(ws: ServerWebSocket, errorType: string, seq: number | undefined, errorCode: string, reason: string) {
  if (ws.readyState === ServerWebSocket.OPEN) {
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
  try {
    const s1_1_seed = DEFAULT_WORLD_SEED; 
    console.log(`[Server] S1-1: Running genChunk heightmap consistency test with seed ${s1_1_seed}...`);
    // Wrapper for genChunk to match the test signature
    const genChunkForTest = async (seed: number, cX: number, cZ: number): Promise<ServerGenChunkResult> => {
      return await genChunk(seed, cX, cZ, LODLevel.HIGH); // Use HIGH LOD for this test, added await
    };
    const s1_1_test_passed = await testS1_1_HeightmapConsistency(genChunkForTest, s1_1_seed);
    if (s1_1_test_passed) {
      console.log('[Server] S1-1: Heightmap consistency test PASSED.');
    } else {
      console.error('[Server] S1-1: Heightmap consistency test FAILED. Check logs from chunkValidation.');
    }
  } catch (e) {
    console.error('[Server] S1-1: Error during heightmap consistency test execution:', e);
  }

  const server = app.listen(port, () => {
    console.log(`Match server running on port ${port}`);
  });

  const wss = new WebSocketServer({ server });
  const ecsWorld = createServerECSWorld();
  const physicsWorld = createPhysicsWorld();
  const chunkGenQueueInstance = new ChunkGenerationQueue(4); // Concurrency of 4

  const matchState: MatchState = {
    players: new Map(),
    chunks: new Map(),
    lastUpdate: Date.now(),
    ecsWorld: ecsWorld,
    seed: DEFAULT_WORLD_SEED,
    physicsWorld: physicsWorld,
    pendingColliders: [],
    handlesPendingRemoval: [],
    playersAwaitingFullInit: [],
    initialServerLoadComplete: false,
    expectedInitialColliders: 0,
    initialCollidersProcessedCount: 0,
    currentTick: 0, // Initialize currentTick
    chunkGenQueue: chunkGenQueueInstance, // Initialize in matchState object
  };

  console.log('[Server/Pre-warm] Pre-warming initial chunk area and queueing colliders...');
  const preWarmStartTime = performance.now();
  let chunksProcessedForPreWarm = 0;
  const preWarmPromises: Promise<void>[] = [];

  for (let cx = -INITIAL_CHUNK_RADIUS; cx <= INITIAL_CHUNK_RADIUS; cx++) {
    for (let cz = -INITIAL_CHUNK_RADIUS; cz <= INITIAL_CHUNK_RADIUS; cz++) {
      preWarmPromises.push(
        // MODIFIED: Pass LODLevel.HIGH for pre-warmed chunks
        getOrCreateChunk(matchState, matchState.seed, cx, cz, LODLevel.HIGH)
          .then(chunk => {
            if (chunk) {
              chunksProcessedForPreWarm++;
              console.log(`[Server/Pre-warm] Chunk (${cx},${cz}) processed for collider queuing.`);
            } else {
              console.error(`[Server/Pre-warm] Failed to get or create chunk (${cx},${cz}).`);
            }
          })
          .catch(error => {
            console.error(`[Server/Pre-warm] Error processing chunk (${cx},${cz}):`, error);
          })
      );
    }
  }

  await Promise.all(preWarmPromises);
  matchState.expectedInitialColliders = matchState.pendingColliders.length;
  console.log(`[Server/Pre-warm] Expected initial colliders to process: ${matchState.expectedInitialColliders}`);
  const preWarmEndTime = performance.now();
  console.log(`[Server/Pre-warm] Finished processing ${chunksProcessedForPreWarm} chunk(s) in ${(preWarmEndTime - preWarmStartTime).toFixed(2)} ms.`);
  if (chunksProcessedForPreWarm !== (INITIAL_CHUNK_RADIUS * 2 + 1) ** 2) {
    console.warn(`[Server/Pre-warm] Expected ${(INITIAL_CHUNK_RADIUS * 2 + 1) ** 2} chunks, processed ${chunksProcessedForPreWarm}.`);
  }

  let nextPlayerNumericId = 1;

  wss.on('connection', (ws: ServerWebSocket) => {
    if (matchState.players.size + matchState.playersAwaitingFullInit.length >= MAX_CLIENTS) {
      sendError(ws, 'error', undefined, 'ServerFull', 'Server is full');
      ws.close();
      return;
    }

    const playerId = nanoid(6);
    console.log(`[Connect] Player ${playerId} connected. Adding to playersAwaitingFullInit.`);
    const newPlayer: PlayerServer = {
      id: playerId,
      ws: ws,
      lastProcessedInputSeq: 0,
    };
    matchState.playersAwaitingFullInit.push(newPlayer);

    ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      if (isBinary) {
        // Data is a Buffer, and it's a binary frame (PLAYER_INPUT FlatBuffer)
        const artificialMessage = { commandType: ClientCommandType.PLAYER_INPUT };
        // Ensure 'data' is treated as Buffer; ws types state it can be ArrayBuffer here too,
        // but for Node.js 'ws' server, 'data' is Buffer when binary if binaryType is 'nodebuffer' (default) or 'buffer'
        handleMessage(ws, artificialMessage, data as Buffer, matchState, wss, playerId, newPlayer);
      } else {
        // Data is a string or a Buffer containing a UTF-8 string (JSON message)
        const jsonDataString = Buffer.isBuffer(data) ? data.toString('utf8') : data;
        try {
          const parsedMessage = JSON.parse(jsonDataString);
          // Pass null for rawBuffer as this is a JSON message
          handleMessage(ws, parsedMessage, null, matchState, wss, playerId, newPlayer);
        } catch (error) {
          console.error('[Server] Error parsing string message (JSON parse):', error, jsonDataString);
          sendError(ws, 'error', undefined, 'InvalidJSON', 'Could not parse JSON message.');
        }
      }
    });

    ws.on('close', () => {
      console.log(`[Disconnect] Player ${playerId} disconnected.`);
      const awaitingIndex = matchState.playersAwaitingFullInit.findIndex(p => p.id === playerId);
      if (awaitingIndex > -1) {
        matchState.playersAwaitingFullInit.splice(awaitingIndex, 1);
        console.log(`[Disconnect] Removed ${playerId} from playersAwaitingFullInit.`);
      }
      const playerToRemove = matchState.players.get(playerId);
      if (playerToRemove) {
        removePlayerPhysicsBody(matchState.physicsWorld.raw, playerToRemove.bodyHandle, playerToRemove.colliderHandle);
        matchState.players.delete(playerId);
        console.log(`[Disconnect] Removed ${playerId} from active players and physics world.`);
      }
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === ServerWebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'playerLeft', playerId: playerId }));
        }
      });
    });
  });

  async function handleMessage(
    ws: ServerWebSocket,
    message: any, 
    rawBuffer: Buffer | null, 
    currentMatchState: MatchState,
    wssInstance: WebSocketServer, 
    cmdPlayerIdFromConnection: string,
    playerObjectContext: PlayerServer
  ) {
    const cmdPlayerId = cmdPlayerIdFromConnection;
    const commandType = message.commandType || message.type;
    // Ensure player object exists (either from active players or awaiting init)
    const player = currentMatchState.players.get(cmdPlayerId) || currentMatchState.playersAwaitingFullInit.find(p => p.id === cmdPlayerId);

    if (!player) {
      console.warn(`[HandleMessage] Player ${cmdPlayerId} not found. Ignoring message type: ${commandType}.`);
      return;
    }
    
    // If it's player input BUT the player isn't fully initialized (no bodyHandle yet),
    // log it, maybe update lastProcessedInputSeq from a quick parse if safe, but don't apply physics.
    if (commandType === ClientCommandType.PLAYER_INPUT && player.bodyHandle === undefined) {
      if (rawBuffer) {
        console.log(`[Server Received PLAYER_INPUT for uninitialized player ${player.id}] Length: ${rawBuffer.length}`);
        // Optionally, attempt a light parse just for seq if critical for early ack, but be wary of errors.
        // For now, just log and ignore for physics processing.
        try {
            const tempByteBuffer = new ByteBuffer(new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength));
            const tempCmd = PlayerInput.getRootAsPlayerInput(tempByteBuffer);
            const tempSeq = tempCmd.seq();
            console.log(`[Server PLAYER_INPUT for uninitialized player ${player.id}] Received seq: ${tempSeq}. Player still initializing, input not applied to physics.`);
            // player.lastProcessedInputSeq = tempSeq; // Consider if this is safe or needed before full init
        } catch (e) {
            console.warn(`[Server PLAYER_INPUT for uninitialized player ${player.id}] Minor error parsing seq for logging:`, e);
        }
      }
      return; // Input from uninitialized player, physics cannot be applied yet.
    }

    // Main message processing for initialized players or non-PLAYER_INPUT messages
    switch (commandType) {
      case ClientCommandType.PLAYER_INPUT: {
        // This case is now only for fully initialized players (player.bodyHandle IS defined)
        if (!rawBuffer) {
          console.warn(`[Server PLAYER_INPUT] Player ${player.id} sent non-binary input for PLAYER_INPUT. Ignoring.`);
            return;
        }

        const byteBuffer = new ByteBuffer(new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength));
        const playerInput = PlayerInput.getRootAsPlayerInput(byteBuffer);
          
        const seq = playerInput.seq();
        player.lastProcessedInputSeq = seq;

        // Declarations moved up and consolidated here for NaN check and logging
        const inputYaw = playerInput.yaw();
        const inputIsFlying = playerInput.isFlying();
        const inputJumpPressed = playerInput.jumpPressed();
        const inputFlyDownPressed = playerInput.flyDownPressed(); // Added for S6-2
        const movementIntentFlatbuffer = playerInput.movementIntent(); // Renamed to avoid conflict with later logic if any, though it's used to set intentX/Z here

        let intentX = 0;
        let intentZ = 0;

        if (movementIntentFlatbuffer) {
            intentX = movementIntentFlatbuffer.x(); 
            intentZ = movementIntentFlatbuffer.z();
        }
        
        player.lastInputHadMovementIntent = (intentX !== 0 || intentZ !== 0); // Set the flag

        // console.log(`[Server Input DEBUG] Player: ${player.id}, Seq: ${seq}, Yaw: ${inputYaw}, Flying: ${inputIsFlying}, Jump: ${inputJumpPressed}, IntentX: ${intentX}, IntentZ: ${intentZ}`);

        if (isNaN(inputYaw) || isNaN(intentX) || isNaN(intentZ)) {
            console.error(`[Server Input ERROR] NaN detected for player ${player.id}, Seq: ${seq}! Yaw: ${inputYaw}, IntentX: ${intentX}, IntentZ: ${intentZ}. Skipping physics update.`);
            return; // Skip processing this specific input
        }

        if (player.bodyHandle === undefined) { // Check for undefined specifically
            console.warn(`[Server PLAYER_INPUT] Player ${player.id} (seq: ${seq}) has no bodyHandle. Input not applied.`);
            return;
          }
          const body = currentMatchState.physicsWorld.raw.getRigidBody(player.bodyHandle);
          if (!body) {
            console.warn(`[Server PLAYER_INPUT] Player ${player.id} (seq: ${seq}) body not found for handle ${player.bodyHandle}. Input not applied.`);
            return;
          }

          const currentLinvel = body.linvel(); 
        // const currentAngvel = body.angvel(); // currentAngvel is not used, can be commented or removed if not needed later
        let newLinvel = { x: currentLinvel.x, y: currentLinvel.y, z: currentLinvel.z };
        // let newAngvel = { x: currentAngvel.x, y: currentAngvel.y, z: currentAngvel.z }; // newAngvel is not used

        // player.isFlying, intentX, intentZ, inputYaw, inputJumpPressed are already defined from above
        
        player.isFlying = inputIsFlying; // Update server-side player state based on checked input

        // Grounded movement
        if (!player.isFlying) {
          const wishSpeed = MAX_SPEED;

          // Use THREE.js for rotation math
          const threeMovementInputVector = new THREE.Vector3(intentX, 0, intentZ);
          const threeYawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inputYaw);
          threeMovementInputVector.applyQuaternion(threeYawQuat); // Rotates in place

          if (threeMovementInputVector.lengthSq() > 1e-6) { 
            threeMovementInputVector.normalize(); 
            newLinvel.x = threeMovementInputVector.x * wishSpeed;
            newLinvel.z = threeMovementInputVector.z * wishSpeed;
          } else { // Deceleration for grounded
            // const DAMPING_FACTOR = 0.90; // Old hardcoded value
            newLinvel.x *= GROUND_DAMP; // P0-1: Use GROUND_DAMP
            newLinvel.z *= GROUND_DAMP; // P0-1: Use GROUND_DAMP
          }

          // Handle Jump - Apply an upward impulse if on ground
          const isOnGroundServer = checkIsOnGround(body, currentMatchState.physicsWorld.raw, currentMatchState.chunks, currentMatchState, player.id);
          if (inputJumpPressed && isOnGroundServer) {
            newLinvel.y = 7; // Jump velocity
          } else if (!isOnGroundServer) {
            // Gravity is handled by physics engine
          } else {
            // On ground, not jumping. Let physics solver handle Y velocity unless specific reset needed.
          }

        } else { // Flying movement
          const flyingSpeed = SERVER_FLYING_SPEED; // Use defined flying speed
          
          // Use THREE.js for rotation math
          const threeMovementInputVectorFlying = new THREE.Vector3(intentX, 0, intentZ);
          const threeYawQuatFlying = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inputYaw);
          threeMovementInputVectorFlying.applyQuaternion(threeYawQuatFlying); // Rotates in place
          
          // Normalize if non-zero, then apply speed
          if (threeMovementInputVectorFlying.lengthSq() > 1e-6) {
             threeMovementInputVectorFlying.normalize();
          }
          newLinvel.x = threeMovementInputVectorFlying.x * flyingSpeed;
          newLinvel.z = threeMovementInputVectorFlying.z * flyingSpeed;
          
          if (inputJumpPressed) {
            newLinvel.y = flyingSpeed / 2; // Fly up speed
          } else if (inputFlyDownPressed) { // Added for S6-2
            newLinvel.y = -flyingSpeed / 2; // Fly down speed
          } else {
            // When flying and no jump (vertical movement) input, apply air damping to Y velocity
            // Or, if rules state Y should be 0 unless actively flying up/down, that's different.
            // Current logic sets newLinvel.y = 0, which means no Y damping applied here, it's a hard set.
            // If AIR_DAMP should affect Y-velocity when coasting vertically:
            // newLinvel.y *= AIR_DAMP; // P0-1: Potentially use AIR_DAMP for Y if not actively moving up/down
            // For now, keeping existing logic of y=0 if not jumping, as plan didn't specify Y air damping.
            newLinvel.y = 0; // Maintain altitude unless specific input for up/down
          }
        }
        
        // ADD LOGGING AND ISFINITE CHECK BEFORE SETLINVEL
        // Conditionally log only if there was movement intent from W,A,S,D
        if (intentX !== 0 || intentZ !== 0) {
            console.log(`[Server SetLinvel DEBUG] Player: ${player.id}, Seq: ${seq}, Attempting to setLinvel: { x: ${newLinvel.x.toFixed(2)}, y: ${newLinvel.y.toFixed(2)}, z: ${newLinvel.z.toFixed(2)} }, PlayerIsFlying: ${player.isFlying}, Intent: (${intentX}, ${intentZ})`);
        }

        // Defensive check for NaN/Infinity before calling setLinvel
        if (!isFinite(newLinvel.x) || !isFinite(newLinvel.y) || !isFinite(newLinvel.z)) {
            console.error(`[Server SetLinvel ERROR] NaN/Infinity in newLinvel for player ${player.id}, Seq: ${seq}! Linvel: { x: ${newLinvel.x}, y: ${newLinvel.y}, z: ${newLinvel.z} }. Skipping setLinvel.`);
            // TODO: Consider resetting player velocity to a safe state here if this occurs, e.g., {x:0, y:0, z:0}
        } else {
            body.setLinvel(newLinvel, true);
        }
        
        player.yaw = inputYaw; // Store the latest yaw from client for broadcast and reference

        break;
      }
      case 'chunkRequest': {
        const { cx, cz, seq, lod } = message;
        // TODO: Validate lod (e.g., ensure it's a number, perhaps 0 for HIGH, 1 for LOW as per client's LODLevel enum)
        // For now, we'll assume client sends a valid number representing LODLevel or handle undefined if not sent.
        const requestedLOD = (typeof lod === 'number' && (lod === 0 || lod === 1)) ? lod : 0; // Default to LOD 0 (HIGH) if invalid/missing

        console.log(`[Server ChunkRequest] Received for cx: ${cx}, cz: ${cz}, lod: ${requestedLOD}, seq: ${seq} from player ${cmdPlayerId}`); // Added log

        if (typeof cx !== 'number' || typeof cz !== 'number') {
          sendError(ws, 'chunkResponseError', seq, 'BadRequest', 'Invalid cx/cz.');
          return;
        }
        try {
          // MODIFIED: Pass requestedLOD to getOrCreateChunk
          const chunk = await getOrCreateChunk(currentMatchState, currentMatchState.seed, cx, cz, requestedLOD);
          const voxelsArray = Array.from(chunk.data);
          if (ws.readyState === ServerWebSocket.OPEN) {
            // ADDED requestedLOD to the response as 'lod'
            const responseMessage = { type: 'chunkResponse', cx, cz, voxels: voxelsArray, seq, lod: requestedLOD };
            ws.send(JSON.stringify(responseMessage));
            console.log(`[Server ChunkResponse] Sent for cx: ${cx}, cz: ${cz}, lod: ${requestedLOD}, seq: ${seq} to player ${cmdPlayerId}`); // Added log
          }
        } catch (error) {
          console.error(`[Server] Error processing chunk request for ${cx},${cz}:`, error);
          sendError(ws, 'chunkResponseError', seq, 'InternalServerError', `Error for chunk ${cx},${cz}: ${error instanceof Error ? error.message : String(error)}`);
        }
        break;
      }
      case ClientCommandType.MINE_BLOCK: {
        const { targetVoxelX, targetVoxelY, targetVoxelZ, seq } = message;
        if (typeof targetVoxelX !== 'number' || typeof targetVoxelY !== 'number' || typeof targetVoxelZ !== 'number') {
          sendError(ws, 'mineError', seq, 'InvalidCoordinates', 'Missing coords.');
          break;
        }
        if (targetVoxelX < WORLD_MIN_X || targetVoxelX > WORLD_MAX_X ||
            targetVoxelY < WORLD_MIN_Y || targetVoxelY > WORLD_MAX_Y ||
            targetVoxelZ < WORLD_MIN_Z || targetVoxelZ > WORLD_MAX_Z) {
          sendError(ws, 'mineError', seq, 'OutOfBounds', 'Target out of bounds.');
          break;
        }
        const success = await setBlock(currentMatchState, currentMatchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ, 0);
        if (success) {
          const chunkX = Math.floor(targetVoxelX / CHUNK_SIZE_X);
          const chunkZ = Math.floor(targetVoxelZ / CHUNK_SIZE_Z);
          const localX = ((targetVoxelX % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
          const localY = targetVoxelY;
          const localZ = ((targetVoxelZ % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
          const voxelFlatIndex = localY * (CHUNK_SIZE_X * CHUNK_SIZE_Z) + localZ * CHUNK_SIZE_X + localX;
          const changes: VoxelChange[] = [{ voxelFlatIndex, newBlockId: 0 }];
          const rleBytes = encodeChunkDiff(changes);
          const blockUpdateMessage = {
            type: 'blockUpdate',
            chunkX: chunkX,
            chunkZ: chunkZ,
            rleBytes: Array.from(rleBytes)
          };
          wssInstance.clients.forEach((client: ServerWebSocket) => {
            if (client.readyState === ServerWebSocket.OPEN) {
              client.send(JSON.stringify(blockUpdateMessage));
            }
          });
        } else {
          sendError(ws, 'mineError', seq, 'SetBlockFailed', 'Server failed to set block.');
        }
        break;
      }
      case ClientCommandType.PLACE_BLOCK: {
        const { targetVoxelX, targetVoxelY, targetVoxelZ, blockId, seq } = message;
        if (typeof targetVoxelX !== 'number' || typeof targetVoxelY !== 'number' || typeof targetVoxelZ !== 'number' || typeof blockId !== 'number') {
            sendError(ws, 'placeError', seq, 'InvalidParameters', 'Missing params.');
            break;
        }
        if (targetVoxelX < WORLD_MIN_X || targetVoxelX > WORLD_MAX_X ||
            targetVoxelY < WORLD_MIN_Y || targetVoxelY > WORLD_MAX_Y ||
            targetVoxelZ < WORLD_MIN_Z || targetVoxelZ > WORLD_MAX_Z) {
            sendError(ws, 'placeError', seq, 'OutOfBounds', 'Target out of bounds.');
            break;
        }
        if (blockId <= 0) {
            sendError(ws, 'placeError', seq, 'InvalidBlockID', 'Cannot place air/invalid ID.');
            break;
        }
        const currentBlockValue = await getBlock(currentMatchState, currentMatchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ);
        if (currentBlockValue !== 0 && currentBlockValue !== null) {
            sendError(ws, 'placeError', seq, 'BlockOccupied', `Occupied by ${currentBlockValue}.`);
            break;
        }
        const success = await setBlock(currentMatchState, currentMatchState.seed, targetVoxelX, targetVoxelY, targetVoxelZ, blockId);
        if (success) {
            const chunkX = Math.floor(targetVoxelX / CHUNK_SIZE_X);
            const chunkZ = Math.floor(targetVoxelZ / CHUNK_SIZE_Z);
            const localX = ((targetVoxelX % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
            const localY = targetVoxelY;
            const localZ = ((targetVoxelZ % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
            const voxelFlatIndex = localY * (CHUNK_SIZE_X * CHUNK_SIZE_Z) + localZ * CHUNK_SIZE_X + localX;
            const changes: VoxelChange[] = [{ voxelFlatIndex, newBlockId: blockId }];
            const rleBytes = encodeChunkDiff(changes);
            const blockUpdateMessage = {
                type: 'blockUpdate',
                chunkX: chunkX,
                chunkZ: chunkZ,
                rleBytes: Array.from(rleBytes)
            };
            wssInstance.clients.forEach((client: ServerWebSocket) => {
                if (client.readyState === ServerWebSocket.OPEN) {
                    client.send(JSON.stringify(blockUpdateMessage));
                }
            });
        } else {
            sendError(ws, 'placeError', seq, 'SetBlockFailed', 'Server failed to place.');
        }
        break;
      }
      case 'clientCommand': // Legacy or general command type
        if (cmdPlayerId) {
          const player = currentMatchState.players.get(cmdPlayerId);
          if (player && message.seq !== undefined) {
            player.lastProcessedInputSeq = message.seq;
          }
        }
        break;
      default:
        console.warn(`Unknown command/message type: '${commandType}' from player ${cmdPlayerId}`);
    }
  }

  // Game loop using setInterval
  let gcTickCounter = 0;
  let tickMod = 0; // Added for S5 snapshot throttling
  let queueLogTickCounter = 0; // Added for queue status logging

  setInterval(() => {
    const now = Date.now();
    const delta = (now - matchState.lastUpdate) / 1000;
    matchState.lastUpdate = now;
    matchState.currentTick++; // Increment currentTick

    // 1. Process pending COLLIDER CREATION tasks (from pendingColliders queue)
    // This queue should ideally only contain creation tasks now.
    const collidersToCreateThisTick = Math.min(matchState.pendingColliders.length, MAX_COLLIDERS_PER_TICK);
    for (let i = 0; i < collidersToCreateThisTick; i++) {
      const colliderTask = matchState.pendingColliders.shift();
      if (colliderTask) {
        colliderTask();
        if (!matchState.initialServerLoadComplete) {
          matchState.initialCollidersProcessedCount++;
        }
      }
    }

    // 2. Process pending COLLIDER REMOVAL tasks (from handlesPendingRemoval queue)
    if (matchState.handlesPendingRemoval && matchState.physicsWorld?.raw) {
      const world = matchState.physicsWorld.raw;
      const removalsToProcessThisTick = Math.min(matchState.handlesPendingRemoval.length, MAX_COLLIDER_REMOVALS_PER_TICK);
      for (let i = 0; i < removalsToProcessThisTick; i++) {
        const handle = matchState.handlesPendingRemoval.shift();
        if (handle !== undefined) {
          try {
            const collider = world.getCollider(handle);
            if (collider) {
              world.removeCollider(collider, true); // wakeUp: true
            } else {
              // console.warn(`[GC Remove] Collider handle ${handle} not found in world, skipping removal.`);
            }
          } catch (e) {
            console.error(`[GC Remove] Error removing collider handle ${handle}:`, e);
          }
        }
      }
      if (removalsToProcessThisTick > 0 && matchState.handlesPendingRemoval.length > 0) {
        // console.log(`[GC Remove] Processed ${removalsToProcessThisTick} removals. Remaining: ${matchState.handlesPendingRemoval.length}`);
      }
    }

    if (!matchState.initialServerLoadComplete && 
        matchState.expectedInitialColliders > 0 && 
        matchState.initialCollidersProcessedCount >= matchState.expectedInitialColliders) {
      console.log(`[Server Game Loop] All ${matchState.expectedInitialColliders} expected initial colliders processed. Marking initialServerLoadComplete = true.`);
      matchState.initialServerLoadComplete = true;
    }
    
    if (matchState.initialServerLoadComplete && matchState.playersAwaitingFullInit.length > 0) {
      console.log(`[Server Game Loop] Processing ${matchState.playersAwaitingFullInit.length} players awaiting full init. InitialServerLoadComplete: ${matchState.initialServerLoadComplete}`);
      const stillAwaiting: PlayerServer[] = [];
      matchState.playersAwaitingFullInit.forEach(player => {
        console.log(`[Server Game Loop] Attempting to fully initialize player ${player.id}. WebSocket state: ${player.ws.readyState}`);
        if (player.ws.readyState === ServerWebSocket.OPEN) {
          try {
            let spawnY = PLAYER_SPAWN_POS.y;
            const spawnChunkKeyWithLOD = `0,0,L${LODLevel.HIGH}`; // Correct key for pre-warmed HIGH LOD chunk
            const spawnChunk = matchState.chunks.get(spawnChunkKeyWithLOD); 

            if (spawnChunk && spawnChunk.heightmap && spawnChunk.heightmap.length === CHUNK_SIZE_X * CHUNK_SIZE_Z) {
              const heightAtSpawn = spawnChunk.heightmap[0]; // Height at local 0,0 within chunk 0,0
              console.log(`[Server SpawnHeight] For player ${player.id} at chunk (0,0), local (0,0): heightmap value (Y_of_block) = ${heightAtSpawn}`);
              const FEET_EPS = 0.05; // tiny safety gap
              const HALF_PLAYER_HEIGHT = PLAYER_HEIGHT / 2;
              const groundSurfaceY = heightAtSpawn + 1; // Player stands on top of the block
              spawnY = groundSurfaceY + HALF_PLAYER_HEIGHT + FEET_EPS;
              console.log(`[Server Spawn] Calculated spawn Y for ${player.id} as ${spawnY.toFixed(2)} based on chunk (0,0) block Y ${heightAtSpawn}. Ground Surface Y: ${groundSurfaceY}, Half Height: ${HALF_PLAYER_HEIGHT}, EPS: ${FEET_EPS}`);
              const capsuleBottom = spawnY - HALF_PLAYER_HEIGHT;
              console.log(`[spawn debug] Y_of_block=${heightAtSpawn.toFixed(2)} ground_surface=${groundSurfaceY.toFixed(2)} spawnY_center=${spawnY.toFixed(2)} capsuleBottom=${capsuleBottom.toFixed(2)}`);
            } else {
              console.warn(`[Server Spawn] Chunk (0,0) or its heightmap not available for player ${player.id}. Falling back to default spawn Y: ${spawnY}. Chunk: ${spawnChunk}, Heightmap valid: ${spawnChunk?.heightmap && spawnChunk.heightmap.length === CHUNK_SIZE_X * CHUNK_SIZE_Z}`);
            }

            const dynamicSpawnPos = { x: PLAYER_SPAWN_POS.x, y: spawnY, z: PLAYER_SPAWN_POS.z };
            const { body, collider } = createPlayerBody(matchState.physicsWorld.raw, dynamicSpawnPos); // Use matchState
            player.bodyHandle = body.handle;
            player.colliderHandle = collider.handle;
            matchState.players.set(player.id, player); // Use matchState
            console.log(`[Server] Player ${player.id} physics body created (H:${body.handle}) at (${dynamicSpawnPos.x.toFixed(2)}, ${dynamicSpawnPos.y.toFixed(2)}, ${dynamicSpawnPos.z.toFixed(2)}) and added to active players.`);

            const initMessage = {
              type: 'init',
              playerId: player.id,
              initialPos: dynamicSpawnPos, // Use the calculated dynamicSpawnPos
              state: {
                players: Array.from(matchState.players.values())
                  .filter(p => p.id !== player.id && p.bodyHandle !== undefined)
                  .map(p => {
                    const pBody = matchState.physicsWorld.raw.getRigidBody(p.bodyHandle!);
                    return {
                      id: p.id,
                      position: pBody ? pBody.translation() : {x:0,y:0,z:0},
                    };
                  }),
              },
            };
            player.ws.send(JSON.stringify(initMessage));
            console.log(`[Server] Sent 'init' message to player ${player.id}`);
          } catch (e) {
            console.error(`[Server] Error fully initializing player ${player.id}:`, e);
            sendError(player.ws, 'error', undefined, 'InitFailed', `Failed to initialize player: ${e instanceof Error ? e.message : String(e)}`);
            player.ws.close();
          }
        } else {
          console.warn(`[Server Game Loop] Player ${player.id} WebSocket is not open (state: ${player.ws.readyState}). Will retry or player will be removed on disconnect.`);
          stillAwaiting.push(player); // Keep them in the queue if their socket wasn't open
        }
      });
      matchState.playersAwaitingFullInit = stillAwaiting; // Update with players whose sockets weren't open
    }

    if (matchState.physicsWorld && matchState.physicsWorld.raw) {
      matchState.physicsWorld.raw.step();

      // Log player states AFTER physics step and apply corrections for flying players
      matchState.players.forEach((player, playerId) => {
        if (player.bodyHandle !== undefined) {
          const body = matchState.physicsWorld.raw.getRigidBody(player.bodyHandle);
          if (body) {
            const pos = body.translation();
            let lvel = body.linvel(); // Make lvel mutable for potential correction

            if (player.isFlying) {
              // Force Y velocity to 0 for flying players post-physics step
              // This corrects any Y velocity introduced by collisions/physics artifacts during the step
              if (lvel.y !== 0) {
                // console.log(`[Server Post-Step Correct] Flying player ${playerId} had linvel.y ${lvel.y.toFixed(3)}. Resetting to 0.`);
                body.setLinvel({ x: lvel.x, y: 0, z: lvel.z }, true);
                lvel = body.linvel(); // Re-fetch corrected linvel for logging
              }
            }
            // Only log if the player's last input had W,A,S,D movement
            if (player.lastInputHadMovementIntent) {
            console.log(`[Server Loop Post-Step ${playerId}] pos: {x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}}, linvel: {x: ${lvel.x.toFixed(2)}, y: ${lvel.y.toFixed(2)}, z: ${lvel.z.toFixed(2)}}, isFlying: ${player.isFlying}`);
            }
          }
        }
      });
    }
    
    // Broadcast state (throttled)
    tickMod++;
    if (tickMod % 2 === 0) { // Example: Broadcast every other tick (e.g., 15Hz if main is 30Hz)
      broadcastState(wss, matchState, matchState.currentTick); // Pass currentTick
    }

    // Log ChunkGenerationQueue status periodically
    queueLogTickCounter++;
    if (queueLogTickCounter % 150 === 0) { // Log approx every 5 seconds (150 ticks / 30 ticks/sec)
      const queueStatus = matchState.chunkGenQueue.getQueueStatus();
      console.log(`[Server ChunkQueue Status] Size: ${queueStatus.queueSize}, Processing: ${queueStatus.processingCount}`);
      queueLogTickCounter = 0;
    }

    if ((gcTickCounter += 1) >= GC_INTERVAL_TICKS) { 
      if (matchState.physicsWorld && matchState.physicsWorld.raw) {
        sweepInactiveChunks(matchState.physicsWorld.raw, matchState);
      }
      gcTickCounter = 0;
    }
  }, TICK_RATE_MS);

  function broadcastState(wssInstance: WebSocketServer, currentMatchState: MatchState, tick: number) {
    if (currentMatchState.players.size === 0 && currentMatchState.playersAwaitingFullInit.length === 0) {
      // console.log(`[Server Broadcast State Tick: ${tick}] No players connected. Skipping broadcast.`);
      return;
    }

    const builder = new FlatbuffersBuilder(1024); // Initialize builder here
    const playerStatesForSnapshot: PlayerData[] = [];

    currentMatchState.players.forEach((player, id) => {
      if (!player.bodyHandle) {
        // console.log(`[Server Broadcast State Tick: ${tick}] Player ${id} has no bodyHandle. Skipping.`);
        return;
      }
      const body = currentMatchState.physicsWorld.raw.getRigidBody(player.bodyHandle);
      if (!body) {
        // console.log(`[Server Broadcast State Tick: ${tick}] Player ${id} body not found. Skipping.`);
        return;
      }

      const pos = body.translation();
      const lvel = body.linvel();
      
      const serverIsGrounded = checkIsOnGround(
        body, 
        currentMatchState.physicsWorld.raw, 
        currentMatchState.chunks,
        currentMatchState, 
        player.id
      );

      const playerData: PlayerData = {
        id,
        position: { x: pos.x, y: pos.y, z: pos.z },
        vel:      { x: lvel.x, y: lvel.y, z: lvel.z },
        yaw:      player.yaw ?? 0, 
        isGrounded: serverIsGrounded,
        isFlying:  player.isFlying ?? false, 
        lastAck:   player.lastProcessedInputSeq ?? 0, 
      };
      playerStatesForSnapshot.push(playerData);

      // Verbose logging, can be removed or made conditional
      // if (tick % 30 === 0) { // Log once per second
      //   console.log(`[Server Broadcast State Tick: ${tick}] Player ${id}: Pos(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}), Linvel(${lvel.x.toFixed(2)}, ${lvel.y.toFixed(2)}, ${lvel.z.toFixed(2)}), Yaw(${player.yaw.toFixed(2)}), Grounded(${serverIsGrounded}), Flying(${player.isFlying}), Ack(${player.lastProcessedInputSeq})`);
      // }
    });

    if (playerStatesForSnapshot.length > 0) {
      // console.log(`[Server Broadcast State Tick: ${tick}] Broadcasting state for ${playerStatesForSnapshot.length} player(s).`);
      // console.log(`--- BEGIN SERVER BROADCAST (Tick: ${tick}) ---`); // Header for server log block

      const flatBuffer = encodeServerSnapshot(builder, tick, playerStatesForSnapshot);

      if (flatBuffer) {
        const binaryPayload = flatBuffer.subarray(builder.dataBuffer().position(), builder.dataBuffer().capacity());
        // console.log(`[Server Broadcast State Tick: ${tick}] Sending snapshot of size ${binaryPayload.byteLength} bytes.`);
        wssInstance.clients.forEach(client => {
          if (client.readyState === ServerWebSocket.OPEN) {
            client.send(binaryPayload, { binary: true });
          }
        });
      } else {
        console.warn(`[Server Broadcast State Tick: ${tick}] Failed to encode server snapshot.`);
      }
      // console.log(`--- END SERVER BROADCAST (Tick: ${tick}) ---`); // Footer for server log block
    } else {
      // console.log(`[Server Broadcast State Tick: ${tick}] No player states to broadcast.`);
    }
    builder.clear(); // Good practice to clear the builder
  }

  // Helper function (you'll need to implement its logic based on your world data)
  function checkIsOnGround(
    body: RAPIER.RigidBody, 
    physicsWorld: RAPIER.World, 
    chunks: Map<string, Chunk>,
    currentMatchState: MatchState,
    playerIdForLog: string
  ): boolean {
    // Basic check: raycast down a short distance
    const origin = body.translation();
    const rayOrigin = { x: origin.x, y: origin.y - (PLAYER_HEIGHT / 2) + 0.01, z: origin.z }; // Start ray 1cm above capsule bottom
    const rayDir = { x: 0, y: -1, z: 0 };
    const ray = new RAPIER.Ray(rayOrigin, rayDir); // Ensure ray is defined
    const maxToi = 0.15; // Triage Kit 1-B: Align ground-check epsilons (e.g., 0.15m ray length)
    const solid = true; // Check against solid colliders
    const hit = physicsWorld.castRay(ray, maxToi, solid);

    // console.log(`[Server CheckIsOnGround Player: ${playerIdForLog}] Body Origin: (${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)}), Ray Origin: (${rayOrigin.x.toFixed(2)}, ${rayOrigin.y.toFixed(2)}, ${rayOrigin.z.toFixed(2)}), Hit: ${hit !== null}, ToI: ${hit?.toi.toFixed(2) ?? 'N/A'}`);
    return hit !== null;
  }
} // End of startServer async function

// Start the server - this is the single correct call
startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
}); 