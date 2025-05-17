import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createPhysicsWorld, initRapier } from './physics.js';
import type { MatchState, Player, Chunk } from './types.js';
import { ClientCommandType } from './types.js';
import { encodeChunkDiff, type VoxelChange } from '../world/encodeChunkDiff.js';

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

const matchStateStore = new Map<string, MatchState>();

// Helper function to get a block from server's chunk data
function getBlock(matchState: MatchState, worldX: number, worldY: number, worldZ: number): number | null {
  if (worldY < 0 || worldY >= CHUNK_SIZE_Y) return 0;
  const chunkX = Math.floor(worldX / CHUNK_SIZE_X);
  const chunkZ = Math.floor(worldZ / CHUNK_SIZE_Z);
  const localX = ((worldX % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
  const localY = worldY;
  const localZ = ((worldZ % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
  const chunkKey = `${chunkX},${chunkZ}`;
  const chunk = matchState.chunks.get(chunkKey);
  if (!chunk || !chunk.data) return 0;
  const index = localY * CHUNK_SIZE_X * CHUNK_SIZE_Z + localZ * CHUNK_SIZE_X + localX;
  if (index < 0 || index >= chunk.data.length) {
    console.error(`Calculated index ${index} is out of bounds for chunk ${chunkKey} data length ${chunk.data.length}`);
    return 0;
  }
  return chunk.data[index];
}

// Helper function to set a block in server's chunk data
function setBlock(matchState: MatchState, worldX: number, worldY: number, worldZ: number, blockId: number): boolean {
  if (worldY < 0 || worldY >= CHUNK_SIZE_Y) return false;
  const chunkX = Math.floor(worldX / CHUNK_SIZE_X);
  const chunkZ = Math.floor(worldZ / CHUNK_SIZE_Z);
  const localX = ((worldX % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
  const localY = worldY;
  const localZ = ((worldZ % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
  const chunkKey = `${chunkX},${chunkZ}`;
  let chunk = matchState.chunks.get(chunkKey);
  if (!chunk) {
    const newChunkData = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z).fill(0);
    chunk = {
      x: chunkX,
      z: chunkZ,
      data: newChunkData,
      lastModified: Date.now()
    };
    matchState.chunks.set(chunkKey, chunk);
    console.log(`Created new chunk ${chunkKey} on demand for setBlock.`);
  }
  if (!chunk.data) {
      console.error(`Chunk ${chunkKey} data is missing even after creation attempt.`);
      return false;
  }
  const index = localY * CHUNK_SIZE_X * CHUNK_SIZE_Z + localZ * CHUNK_SIZE_X + localX;
  if (index < 0 || index >= chunk.data.length) {
    console.error(`Calculated index ${index} is out of bounds for chunk ${chunkKey} data length ${chunk.data.length} during setBlock`);
    return false;
  }
  chunk.data[index] = blockId;
  chunk.lastModified = Date.now();
  return true;
}

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
  
  // Create HTTP server
  const server = app.listen(port, () => {
    console.log(`Match server running on port ${port}`);
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server });

  // Initialize physics world
  const physicsWorld = createPhysicsWorld();

  // Game state
  const matchState: MatchState = {
    players: new Map(),
    chunks: new Map(),
    lastUpdate: Date.now()
  };

  let nextPlayerId = 1; // Simple ID generator

  // WebSocket connection handler
  wss.on('connection', (ws) => {
    const playerId = `player${nextPlayerId++}`;
    console.log(`New client connected. Assigned ID: ${playerId}`);

    const newPlayer: Player = {
      id: playerId,
      position: { x: 0, y: 70, z: 0 }, // Default spawn position
      rotation: { x: 0, y: 0, z: 0 }, // Default spawn rotation (should be quaternion)
      velocity: { x: 0, y: 0, z: 0 },
      ws: ws, // Associate WebSocket with player
      lastProcessedInputSeq: 0 // Initialize
    };
    matchState.players.set(playerId, newPlayer);

    // Send initial state (now includes the new player)
    ws.send(JSON.stringify({
      type: 'init',
      playerId: playerId, // Send the client its ID
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
      console.log('Client disconnected');
      matchState.players.delete(playerId); // Clean up player state
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
      case 'chunkRequest':
        // TODO: Send chunk data
        break;
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

            if (hasMovement || hasMouseMovement) {
              console.log(`[Server] PLAYER_INPUT from ${cmdPlayerId} (seq: ${message.seq}): Actions:`, message.actions, `Mouse: dx=${message.mouseDeltaX}, dy=${message.mouseDeltaY}`);
            }

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
        const success = setBlock(matchState, targetVoxelX, targetVoxelY, targetVoxelZ, 0);
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
        const currentBlock = getBlock(matchState, targetVoxelX, targetVoxelY, targetVoxelZ);
        if (currentBlock !== 0 && currentBlock !== null) { // Check if block is not air
            sendError(ws, 'placeError', seq, 'BlockOccupied', `Cannot place block at (${targetVoxelX},${targetVoxelY},${targetVoxelZ}), it's occupied by ${currentBlock}.`);
            break;
        }

        const success = setBlock(matchState, targetVoxelX, targetVoxelY, targetVoxelZ, blockIdToPlace);

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