import { WebSocket as ServerWebSocket } from 'ws';
import type { PhysicsWorld } from './physics.js';
export type { PhysicsWorld };
import type { Player as SharedPlayer } from '../shared/types.js'; // Import SharedPlayer
export type { SharedPlayer }; // Re-export SharedPlayer

// Server-specific player type
export interface PlayerServer extends SharedPlayer {
  ws: ServerWebSocket;
  entityId?: number; // If using server-side ECS for players
  bodyHandle?: number; // Make optional, assigned later
  colliderHandle?: number; // Make optional, assigned later
  isFlying?: boolean; // Added to store flying state
  yaw?: number; // Added to store player's yaw
  lastInputHadMovementIntent?: boolean; // Flag to track if last input included W,A,S,D movement
}

// Duplicated from client src/net/types.ts to avoid pathing issues with server's rootDir
export enum ClientCommandType {
  PLAYER_INPUT = 'playerInput',
  MINE_BLOCK = 'mineBlock',
  PLACE_BLOCK = 'placeBlock',
}

export interface Chunk {
  x: number;
  z: number;
  data: Uint8Array;
  heightmap?: Uint8Array;
  lastModified: number;
  colliderHandles?: number[];
}

export interface MatchState {
  players: Map<string, PlayerServer>;
  chunks: Map<string, Chunk>;
  lastUpdate: number;
  seed: number;
  physicsWorld?: PhysicsWorld;
  pendingColliders: (() => void)[];
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