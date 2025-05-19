import { WebSocket as ServerWebSocket } from 'ws';
import type { PhysicsWorld } from './physics.js';
export type { PhysicsWorld };
import type { Player as SharedPlayer } from '../shared/types.js'; // Import SharedPlayer
export type { SharedPlayer }; // Re-export SharedPlayer
import type { ChunkGenerationQueue } from './world/chunkGenerationQueue.js'; // Added import
import type { PlayerServer as WorldPlayerServer, Chunk as WorldChunk } from './world/types.js'; // Import from world/types

// Server-specific player type
// export interface PlayerServer extends SharedPlayer { ... }

// Duplicated from client src/net/types.ts to avoid pathing issues with server's rootDir
export enum ClientCommandType {
  PLAYER_INPUT = 'playerInput',
  MINE_BLOCK = 'mineBlock',
  PLACE_BLOCK = 'placeBlock',
}

// Chunk interface - This can be removed if WorldChunk is sufficient
// export interface Chunk { ... }

export interface MatchState {
  players: Map<string, WorldPlayerServer>; // Use imported PlayerServer
  chunks: Map<string, WorldChunk>; // Use imported Chunk
  lastUpdate: number;
  seed: number;
  physicsWorld?: PhysicsWorld;
  pendingColliders: (() => void)[];
  handlesPendingRemoval?: number[]; // Added for controlled collider removal
  chunkGenQueue: ChunkGenerationQueue; // Made non-optional
}

export type MessageType = 
  | 'init'
  | 'stateUpdate'
  | 'playerUpdate'
  | 'chunkRequest'
  | 'chunkData';

export interface Message {
  type: MessageType;
  [key: string]: any;
}

export interface ServerGenChunkResult {
  // ... existing code ...
} 