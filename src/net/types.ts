export enum ClientCommandType {
  PLAYER_INPUT = 'playerInput',
  MINE_BLOCK = 'mineBlock',
  PLACE_BLOCK = 'placeBlock', // Added for consistency, was in commandType literal
}

export interface ClientCommand {
  seq?: number;
  timestamp?: number;
  // For player input
  type?: string; // TODO: gradually remove, replaced by commandType
  commandType?: ClientCommandType;
  moveForward?: boolean;
  moveBackward?: boolean;
  moveLeft?: boolean;
  moveRight?: boolean;
  jump?: boolean;
  descend?: boolean; // For flying down or crouching
  mouseDeltaX?: number;
  mouseDeltaY?: number;
  // For block interaction commands
  targetVoxelX?: number;
  targetVoxelY?: number;
  targetVoxelZ?: number;
  blockId?: number; // For placeBlock command
}

export interface ConnectionState {
  isConnected: boolean;
  reconnectAttempts: number;
  lastReconnectTime: number;
}

export const MAX_RECONNECT_ATTEMPTS = 4;
export const INITIAL_RECONNECT_DELAY = 1000; // 1 second
export const MAX_RECONNECT_DELAY = 16000; // 16 seconds 