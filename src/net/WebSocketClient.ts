import type { ClientCommand, ConnectionState } from './types';
import { MAX_RECONNECT_ATTEMPTS, INITIAL_RECONNECT_DELAY, MAX_RECONNECT_DELAY } from './types';

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = {
    isConnected: false,
    reconnectAttempts: 0,
    lastReconnectTime: 0
  };
  private reconnectTimeout: number | null = null;
  private url: string;
  public onMessage: ((message: string) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  public connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);
      this.setupWebSocketHandlers();
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.handleDisconnect();
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.connectionState.isConnected = true;
      this.connectionState.reconnectAttempts = 0;
      this.connectionState.lastReconnectTime = Date.now();
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.handleDisconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.handleDisconnect();
    };

    this.ws.onmessage = (event) => {
      if (this.onMessage) {
        this.onMessage(event.data);
      }
    };
  }

  private handleDisconnect(): void {
    this.connectionState.isConnected = false;
    this.ws = null;

    if (this.connectionState.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = this.calculateReconnectDelay();
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.connectionState.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
      
      this.reconnectTimeout = window.setTimeout(() => {
        this.connectionState.reconnectAttempts++;
        this.connect();
      }, delay);
    } else {
      console.log('Max reconnect attempts reached');
    }
  }

  private calculateReconnectDelay(): number {
    const exponentialDelay = INITIAL_RECONNECT_DELAY * Math.pow(2, this.connectionState.reconnectAttempts);
    return Math.min(exponentialDelay, MAX_RECONNECT_DELAY);
  }

  public sendCommand(command: ClientCommand): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // TODO: Convert command to FlatBuffer format
      const message = JSON.stringify(command);
      this.ws.send(message);
    } catch (error) {
      console.error('Failed to send command:', error);
    }
  }

  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connectionState = {
      isConnected: false,
      reconnectAttempts: 0,
      lastReconnectTime: 0
    };
  }
} 