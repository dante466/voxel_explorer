import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createPhysicsWorld, initRapier } from './physics.js';
import type { MatchState } from './types.js';

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

  // WebSocket connection handler
  wss.on('connection', (ws) => {
    console.log('New client connected');

    // Send initial state
    ws.send(JSON.stringify({
      type: 'init',
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
      default:
        console.warn('Unknown message type:', message.type);
    }
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