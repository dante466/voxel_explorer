import { WebSocket } from 'ws';
import type { PhysicsWorld } from './physics.js';

// Duplicated from client src/net/types.ts to avoid pathing issues with server's rootDir
export enum ClientCommandType {
  PLAYER_INPUT = 'playerInput',
  MINE_BLOCK = 'mineBlock',
  PLACE_BLOCK = 'placeBlock',
}

export interface Player {
  id: string;
  entityId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  lastProcessedInputSeq?: number;
  ws?: WebSocket;
}

export interface Chunk {
  x: number;
  z: number;
  data: Uint8Array;
  lastModified: number;
  colliderHandles?: number[];
}

export interface MatchState {
  players: Map<string, Player>;
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