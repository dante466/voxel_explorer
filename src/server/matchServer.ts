import * as express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createPhysicsWorld, initRapier } from './physics.js';
import type { MatchState, Player } from './types.js';

const app = express();
const port = process.env.PORT || 3000;

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
      state: matchState
    }));

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, message);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log('Client disconnected');
      // TODO: Clean up player state
    });
  });

  // Message handler
  function handleMessage(ws: WebSocket, message: any) {
    switch (message.type) {
      case 'playerUpdate':
        // TODO: Update player state and broadcast to other clients
        break;
      case 'chunkRequest':
        // TODO: Send chunk data
        break;
      case 'clientCommand': 
        const cmdPlayerId = getPlayerIdForWebSocket(ws);
        if (cmdPlayerId) {
          const player = matchState.players.get(cmdPlayerId);
          if (player && message.seq !== undefined) { // Ensure seq is present
            // console.log(`Received clientCommand from player ${cmdPlayerId}, seq: ${message.seq}:`, message);
            player.lastProcessedInputSeq = message.seq;
            // TODO: Process the rest of message (movement, actions etc.) to update player state in physics
            // Example: player.inputQueue.push(message); // or apply to physics representation directly
          } else if (!player) {
            console.warn(`Received clientCommand for known player ID ${cmdPlayerId} but player not found in state.`);
          } else if (message.seq === undefined) {
            console.warn(`Received clientCommand from player ${cmdPlayerId} without sequence number.`);
          }
        } else {
          // This should ideally not happen if player is registered on connection
          console.warn('Received clientCommand but could not identify player from WebSocket connection.');
        }
        break;
      default:
        console.warn(`Unknown message type received: '${message.type}'`); // Clarified log
    }
  }

  // Helper function placeholder - you'll need to implement actual player session management
  function getPlayerIdForWebSocket(ws: WebSocket): string | null {
    for (const [id, player] of matchState.players.entries()) {
      if (player.ws === ws) {
        return id;
      }
    }
    return null; // Player not found for this WebSocket connection
  }

  // Game loop
  const TICK_RATE = 1000 / 30; // 30 Hz
  setInterval(() => {
    const now = Date.now();
    const delta = now - matchState.lastUpdate;
    
    // Step physics world
    physicsWorld.step();
    
    // Update game state
    matchState.lastUpdate = now;
    
    // Broadcast state to all clients
    broadcastState();
  }, TICK_RATE);

  // Broadcast state to all connected clients
  function broadcastState() {
    const stateUpdate = {
      type: 'stateUpdate',
      state: matchState
    };
    
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(stateUpdate));
      }
    });
  }
}

// Start the server
startServer().catch(console.error); 