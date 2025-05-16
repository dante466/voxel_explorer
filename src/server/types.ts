export interface Player {
  id: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface Chunk {
  x: number;
  z: number;
  data: Uint8Array;
  lastModified: number;
}

export interface MatchState {
  players: Map<string, Player>;
  chunks: Map<string, Chunk>;
  lastUpdate: number;
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