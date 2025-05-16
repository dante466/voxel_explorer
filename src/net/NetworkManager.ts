import { InputHandler } from './InputHandler';
import { WebSocketClient } from './WebSocketClient';
import type { ClientCommand } from './types';
import type { IWorld } from 'bitecs'; // Import IWorld
import { Transform } from '../ecs/world'; // Import Transform component
// import * as THREE from 'three'; // THREE is no longer directly used for camera

export class NetworkManager {
  private inputHandler: InputHandler;
  private wsClient: WebSocketClient;
  private commandInterval: number | null = null;
  private readonly COMMAND_RATE = 30; // 30 Hz command rate
  // private camera: THREE.PerspectiveCamera; // REMOVED
  private moveSpeed: number = 2.0; // This might be used differently or removed if prediction logic changes significantly

  private world: IWorld;
  private playerEntityId: number;

  constructor(serverUrl: string, world: IWorld, playerEntityId: number) {
    this.inputHandler = new InputHandler();
    this.wsClient = new WebSocketClient(serverUrl);
    this.world = world;
    this.playerEntityId = playerEntityId;
    // this.camera = camera; // REMOVED
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    this.wsClient.onMessage = (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'stateUpdate') {
          if (data.state && data.state.id === this.playerEntityId) { // Assuming server sends entity ID
            if (data.state.position) {
              Transform.position.x[this.playerEntityId] = data.state.position.x;
              Transform.position.y[this.playerEntityId] = data.state.position.y;
              Transform.position.z[this.playerEntityId] = data.state.position.z;
              // console.log(`NetworkManager: Updated player ${this.playerEntityId} position to`, data.state.position);
            }
            if (data.state.rotation) { // Assuming rotation is a quaternion {x,y,z,w}
              Transform.rotation.x[this.playerEntityId] = data.state.rotation.x;
              Transform.rotation.y[this.playerEntityId] = data.state.rotation.y;
              Transform.rotation.z[this.playerEntityId] = data.state.rotation.z;
              Transform.rotation.w[this.playerEntityId] = data.state.rotation.w;
              // console.log(`NetworkManager: Updated player ${this.playerEntityId} rotation to`, data.state.rotation);
            }
          } else if (data.state && data.state.id !== this.playerEntityId) {
            // Handle state for other entities if necessary in the future
          } else {
            // Fallback for older message format or general state, if any
            // This part might need adjustment based on exact server messages for general state updates
            console.log('Received general stateUpdate:', data.state);
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
      
      // Get camera's forward and right vectors - REMOVED
      // This client-side prediction needs to be re-thought with ECS.
      // It should ideally modify the player entity's Transform or Velocity components.
      // const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      // const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      
      // Apply local movement prediction relative to camera direction - REMOVED
      // if (command.moveForward) {
      //   this.camera.position.addScaledVector(forward, this.moveSpeed);
      // }
      // if (command.moveBackward) {
      //   this.camera.position.addScaledVector(forward, -this.moveSpeed);
      // }
      // if (command.moveLeft) {
      //   this.camera.position.addScaledVector(right, -this.moveSpeed);
      // }
      // if (command.moveRight) {
      //   this.camera.position.addScaledVector(right, this.moveSpeed);
      // }
      // if (command.moveUp) {
      //   this.camera.position.y += this.moveSpeed;
      // }
      // if (command.moveDown) {
      //   this.camera.position.y -= this.moveSpeed;
      // }
      
      // Send command to server
      this.wsClient.sendCommand(command); // Still send commands
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