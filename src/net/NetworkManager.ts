import { InputHandler } from './InputHandler';
import { WebSocketClient } from './WebSocketClient';
import type { ClientCommand } from './types';
import * as THREE from 'three';

export class NetworkManager {
  private inputHandler: InputHandler;
  private wsClient: WebSocketClient;
  private commandInterval: number | null = null;
  private readonly COMMAND_RATE = 30; // 30 Hz command rate
  private camera: THREE.PerspectiveCamera;
  private moveSpeed: number = 2.0;

  constructor(serverUrl: string, camera: THREE.PerspectiveCamera) {
    this.inputHandler = new InputHandler();
    this.wsClient = new WebSocketClient(serverUrl);
    this.camera = camera;
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    this.wsClient.onMessage = (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'stateUpdate') {
          // Update camera position based on server state
          if (data.state.playerPosition) {
            this.camera.position.set(
              data.state.playerPosition.x,
              data.state.playerPosition.y,
              data.state.playerPosition.z
            );
          }
        }
      } catch (error) {
        console.error('Error handling server message:', error);
      }
    };
  }

  public connect(): void {
    this.wsClient.connect();
    this.startCommandLoop();
  }

  public disconnect(): void {
    this.stopCommandLoop();
    this.wsClient.disconnect();
  }

  private startCommandLoop(): void {
    if (this.commandInterval) return;

    this.commandInterval = window.setInterval(() => {
      const command = this.inputHandler.getCommand();
      
      // Get camera's forward and right vectors
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      
      // Apply local movement prediction relative to camera direction
      if (command.moveForward) {
        this.camera.position.addScaledVector(forward, this.moveSpeed);
      }
      if (command.moveBackward) {
        this.camera.position.addScaledVector(forward, -this.moveSpeed);
      }
      if (command.moveLeft) {
        this.camera.position.addScaledVector(right, -this.moveSpeed);
      }
      if (command.moveRight) {
        this.camera.position.addScaledVector(right, this.moveSpeed);
      }
      if (command.moveUp) {
        this.camera.position.y += this.moveSpeed;
      }
      if (command.moveDown) {
        this.camera.position.y -= this.moveSpeed;
      }
      
      // Send command to server
      this.wsClient.sendCommand(command);
      this.inputHandler.resetMouseDelta();
    }, 1000 / this.COMMAND_RATE);
  }

  private stopCommandLoop(): void {
    if (this.commandInterval) {
      clearInterval(this.commandInterval);
      this.commandInterval = null;
    }
  }
} 