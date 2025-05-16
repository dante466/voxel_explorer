import { InputHandler } from './InputHandler';
import { WebSocketClient } from './WebSocketClient';
import type { ClientCommand } from './types';
import type { IWorld } from 'bitecs'; // Import IWorld
import { Transform } from '../ecs/world'; // Import Transform component
import { CameraTarget } from '../ecs/components/CameraTarget'; // For cameraYaw
import { calculatePlayerMovement, type PlayerMovementInputState, type PlayerMovementOutputState, type PlayerMovementSystemControls } from '../ecs/systems/playerMovementSystem'; // For replaying inputs
import { type ChunkManager } from '../world/ChunkManager'; // Required by calculatePlayerMovement
import * as THREE from 'three'; // For THREE.Vector3 in reconciliation
// import * as THREE from 'three'; // THREE is no longer directly used for camera

interface PendingInput {
  seq: number;
  keys: { [key: string]: boolean }; // Captured key states
  cameraYaw: number;
  currentIsFlying: boolean;
  deltaTime: number;
  // The raw ClientCommand is stored for sending, not directly for replay with calculatePlayerMovement
  rawCommand: ClientCommand; 
}

export class NetworkManager {
  private inputHandler: InputHandler;
  private wsClient: WebSocketClient;
  private commandInterval: number | null = null;
  private readonly COMMAND_RATE = 30; // 30 Hz command rate
  // private camera: THREE.PerspectiveCamera; // REMOVED
  private moveSpeed: number = 2.0; // This might be used differently or removed if prediction logic changes significantly

  private world: IWorld;
  private playerEntityId: number;
  private movementSystemControls: PlayerMovementSystemControls; // To get isFlying and keyStates
  private chunkManager: ChunkManager; // For calculatePlayerMovement

  private clientInputSequenceNumber = 0;
  private pendingInputs: PendingInput[] = [];

  // Temporary vectors for calculations to avoid allocations in loop
  private tempCurrentPosition = new THREE.Vector3();
  private tempServerPosition = new THREE.Vector3();

  constructor(
    serverUrl: string, 
    world: IWorld, 
    playerEntityId: number, 
    movementSystemControls: PlayerMovementSystemControls, // Added
    chunkManager: ChunkManager // Added
  ) {
    this.inputHandler = new InputHandler();
    this.wsClient = new WebSocketClient(serverUrl);
    this.world = world;
    this.playerEntityId = playerEntityId;
    this.movementSystemControls = movementSystemControls;
    this.chunkManager = chunkManager;
    // this.camera = camera; // REMOVED
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    this.wsClient.onMessage = (message: string) => {
      try {
        const data = JSON.parse(message);
        // Assuming server sends: { type: 'stateUpdate', state: { id, position: {x,y,z}, rotation: {x,y,z,w}, lastProcessedInputSeq } }
        if (data.type === 'stateUpdate' && data.state && data.state.id === this.playerEntityId) {
          const serverState = data.state;
          // console.log('Received server state:', serverState);

          // Update Transform to server state (snap)
          Transform.position.x[this.playerEntityId] = serverState.position.x;
          Transform.position.y[this.playerEntityId] = serverState.position.y;
          Transform.position.z[this.playerEntityId] = serverState.position.z;
          
          Transform.rotation.x[this.playerEntityId] = serverState.rotation.x;
          Transform.rotation.y[this.playerEntityId] = serverState.rotation.y;
          Transform.rotation.z[this.playerEntityId] = serverState.rotation.z;
          Transform.rotation.w[this.playerEntityId] = serverState.rotation.w;

          // Remove acknowledged inputs
          this.pendingInputs = this.pendingInputs.filter(input => input.seq > serverState.lastProcessedInputSeq);
          
          // Replay pending inputs
          let currentYVelocity = 0; // This needs to be managed across replays if PlayerMovementSystem's yVelocity isn't directly accessible
                                    // For simplicity, assuming yVelocity is reset or implicitly handled by calculatePlayerMovement logic for short replays.
                                    // A more robust solution might need PlayerMovementSystem to expose its yVelocity or for calculatePlayerMovement to also return it for the next iteration.
                                    // The current calculatePlayerMovement takes currentYVelocity and returns newYVelocity. We need to thread this.

          // Get the yVelocity that corresponds to the server state (or make an assumption)
          // This is tricky because yVelocity is internal to PlayerMovementSystem. 
          // For now, we might have to reset it or rely on the ground check in calculatePlayerMovement.
          // Let's assume for the replay, yVelocity starts fresh or is based on what calculatePlayerMovement does.
          // If the serverState also included yVelocity, that would be ideal.
          // For now, we will fetch the PlayerMovementSystem's current yVelocity. This is not perfect as it has advanced since the server state.
          // This is a known simplification for now.

          // After snapping to server state, capture the current yVelocity from PlayerMovementSystem
          // This isn't ideal because playerMovementSystem's yVelocity is ahead.
          // A better approach: if calculatePlayerMovement returned newYVelocity, we'd use that iteratively.
          // The refactored `calculatePlayerMovement` *does* return newYVelocity.
          
          // Let's refine replay: yVelocity must be threaded through the replay loop.
          // We need to know the yVelocity *at the server state*. This is missing.
          // Simplification: Assume player is on ground or flying if yVelocity is not sent by server.
          // Or, get the yVelocity from the current player entity state (which is now server state)
          // and hope it's somewhat relevant. This is a point of potential inaccuracy.

          // Let's try to get PlayerMovementSystem to expose its yVelocity or make calculatePlayerMovement work for this.
          // The current `calculatePlayerMovement` should be fine if we thread its output `newYVelocity` into the next input `currentYVelocity`.
          
          // Initial yVelocity for replay: if player on ground based on serverState.position, yVel=0. Otherwise, it's complicated.
          // For now, we'll use a temporary yVelocity for the replay sequence. This is a simplification.
          // We will assume that the `PlayerMovementSystem`'s own `yVelocity` is reset upon `toggleFlying` which might happen during replay of `F` key.
          // The `calculatePlayerMovement` function takes `currentYVelocity`.

          // Retrieve the Y velocity from the player entity after it's been snapped to server state.
          // This relies on PlayerMovementSystem having updated it based on that snapped state in a previous frame, which is not true.
          // This implies calculatePlayerMovement needs to be more self-contained or server must send yVelocity.
          // For now, this will be a source of slight inaccuracy. We reset it to 0 for simplicity.
          let yVelocityForReplay = 0; // Simplified: reset for replay sequence.

          for (const pending of this.pendingInputs) {
            this.tempCurrentPosition.set(
              Transform.position.x[this.playerEntityId],
              Transform.position.y[this.playerEntityId],
              Transform.position.z[this.playerEntityId]
            );
            const inputState: PlayerMovementInputState = {
              currentPosition: this.tempCurrentPosition,
              currentYVelocity: yVelocityForReplay, // Use the evolving yVelocityForReplay
              currentIsFlying: pending.currentIsFlying,
              cameraYaw: pending.cameraYaw,
              keys: pending.keys,
              deltaTime: pending.deltaTime,
              chunkManager: this.chunkManager,
            };

            const outputState = calculatePlayerMovement(inputState);

            Transform.position.x[this.playerEntityId] = outputState.newPosition.x;
            Transform.position.y[this.playerEntityId] = outputState.newPosition.y;
            Transform.position.z[this.playerEntityId] = outputState.newPosition.z;
            yVelocityForReplay = outputState.newYVelocity; // Thread the yVelocity
          }

        } else if (data.type === 'stateUpdate') {
          // Handle other entities if needed
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
      this.clientInputSequenceNumber++;
      const deltaTime = 1 / this.COMMAND_RATE;

      // Capture necessary state for replay
      const currentKeys = this.movementSystemControls.getKeyStates();
      const currentCameraYaw = CameraTarget.yaw[this.playerEntityId];
      const flyingStatus = this.movementSystemControls.isFlying();

      this.pendingInputs.push({
        seq: this.clientInputSequenceNumber,
        keys: currentKeys,
        cameraYaw: currentCameraYaw,
        currentIsFlying: flyingStatus,
        deltaTime: deltaTime,
        rawCommand: command, // Store the raw command for sending
      });

      // Send command with sequence number and type to server
      this.wsClient.sendCommand({ 
        type: "clientCommand", // Added type for the server to recognize
        ...command, 
        seq: this.clientInputSequenceNumber 
      }); 
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