export interface ClientCommand {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  moveUp: boolean;
  moveDown: boolean;
  mouseX: number;
  mouseY: number;
  timestamp: number;
}

export interface ConnectionState {
  isConnected: boolean;
  reconnectAttempts: number;
  lastReconnectTime: number;
}

export const MAX_RECONNECT_ATTEMPTS = 4;
export const INITIAL_RECONNECT_DELAY = 1000; // 1 second
export const MAX_RECONNECT_DELAY = 16000; // 16 seconds 