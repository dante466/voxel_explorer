import { InputHandler } from './InputHandler';
import { WebSocketClient } from './WebSocketClient';
import type { ClientCommand } from './types';
import { ClientCommandType } from './types';
import type { IWorld } from 'bitecs'; // Import IWorld
import { Transform } from '../ecs/world'; // Import Transform component
import { CameraTarget } from '../ecs/components/CameraTarget'; // For cameraYaw
import { calculatePlayerMovement, type PlayerMovementInputState, type PlayerMovementOutputState, type PlayerMovementSystemControls } from '../ecs/systems/PlayerMovementSystem'; // For replaying inputs
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
  // private tempServerPosition = new THREE.Vector3(); // No longer used here

  constructor(
    serverUrl: string, 
    world: IWorld, 
    playerEntityId: number, 
    movementSystemControls: PlayerMovementSystemControls, // Added
    chunkManager: ChunkManager // Added
  ) {
    this.inputHandler = new InputHandler();
    this.world = world;
    this.playerEntityId = playerEntityId;
    this.movementSystemControls = movementSystemControls;
    this.chunkManager = chunkManager;
    // this.camera = camera; // REMOVED

    // Provide onOpen callback to WebSocketClient
    this.wsClient = new WebSocketClient(serverUrl, (socket) => {
      if (this.chunkManager) {
        this.chunkManager.setSocket(socket);
      }
    });

    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    this.wsClient.onMessage = (message: string) => {
      try {
        const data = JSON.parse(message);
        
        // First, check for chunkManager specific messages if chunkManager is available
        if (this.chunkManager) {
          if (data.type === 'chunkResponse') {
            if (typeof data.cx === 'number' && typeof data.cz === 'number' && Array.isArray(data.voxels)) {
              this.chunkManager.handleChunkResponse(data.cx, data.cz, data.voxels.filter((v: any) => typeof v === 'number'));
            } else {
              console.warn('[NetworkManager] Received malformed chunkResponse:', data);
            }
            return; // Message handled by ChunkManager
          } else if (data.type === 'chunkResponseError') {
            if (typeof data.cx === 'number' && typeof data.cz === 'number' && typeof data.reason === 'string') {
              this.chunkManager.handleChunkResponseError(data.cx, data.cz, data.reason);
            } else {
              console.warn('[NetworkManager] Received malformed chunkResponseError:', data);
            }
            return; // Message handled by ChunkManager
          }
        }

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

        } else if (data.type === 'blockUpdate') {
          // Server confirmed a block change (e.g., after mining)
          console.log('Received blockUpdate (RLE) from server:', data);
          if (typeof data.chunkX === 'number' && typeof data.chunkZ === 'number' && Array.isArray(data.rleBytes)) {
            // Ensure rleBytes contains numbers, as it comes from JSON
            const numericRleBytes: number[] = data.rleBytes.filter((b: any) => typeof b === 'number');
            if (numericRleBytes.length !== data.rleBytes.length) {
                console.warn('NetworkManager: Received rleBytes with non-numeric values.', data.rleBytes);
            }            
            if (numericRleBytes.length > 0) {
                this.chunkManager.applyRLEUpdate(data.chunkX, data.chunkZ, numericRleBytes)
                    .catch(error => {
                        console.error('Error applying RLE update to chunkManager:', error);
                    });
            } else if (data.rleBytes.length > 0) {
                // This case means rleBytes was an array but all elements were non-numeric or it was filtered to empty
                console.warn('NetworkManager: rleBytes received but resulted in empty numeric array after filtering.', data.rleBytes);
            } else {
                // rleBytes was genuinely empty array, could be valid if server can send empty diffs.
                console.log('NetworkManager: Received empty rleBytes array for blockUpdate. No changes to apply.');
            }
          } else {
            console.warn('NetworkManager: Received malformed blockUpdate message (RLE expected):', data);
          }
        } else if (data.type === 'mineError') {
          // Server sent a mining error
          console.error(`Mine Error (seq: ${data.seq}, code: ${data.code}): ${data.reason}`);
          // Potentially alert the user or revert optimistic updates if we add them later
        } else if (data.type === 'placeError') {
          console.error(`Place Error (seq: ${data.seq}, code: ${data.code}): ${data.reason}`);
          // Potentially alert the user or revert optimistic updates
        } else if (data.type === 'stateUpdate') { // For other entities, if ever needed
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

  // New method to send a mine command
  public sendMineCommand(voxelX: number, voxelY: number, voxelZ: number): void {
    this.clientInputSequenceNumber++;
    const command: ClientCommand = {
      commandType: ClientCommandType.MINE_BLOCK,
      seq: this.clientInputSequenceNumber,
      timestamp: Date.now(),
      targetVoxelX: voxelX,
      targetVoxelY: voxelY,
      targetVoxelZ: voxelZ,
    };
    this.wsClient.sendCommand(command);
    console.log('Sent MineBlockCommand:', command); 
  }

  public sendPlaceCommand(voxelX: number, voxelY: number, voxelZ: number, blockId: number): void {
    this.clientInputSequenceNumber++;
    const command: ClientCommand = {
      commandType: ClientCommandType.PLACE_BLOCK,
      seq: this.clientInputSequenceNumber,
      timestamp: Date.now(),
      targetVoxelX: voxelX,
      targetVoxelY: voxelY,
      targetVoxelZ: voxelZ,
      blockId: blockId,
    };
    this.wsClient.sendCommand(command);
    console.log('Sent PlaceBlockCommand:', command);
  }

  private startCommandLoop(): void {
    if (this.commandInterval) return;

    this.commandInterval = window.setInterval(() => {
      const inputHandlerCommand = this.inputHandler.getCommand();
      this.clientInputSequenceNumber++;
      const deltaTime = 1 / this.COMMAND_RATE; // Still needed for pending inputs if we decide to keep them separate

      const currentKeys = this.movementSystemControls.getKeyStates();
      const currentCameraYaw = CameraTarget.yaw[this.playerEntityId];
      const flyingStatus = this.movementSystemControls.isFlying();

      const playerInputCommand: ClientCommand = {
        commandType: ClientCommandType.PLAYER_INPUT,
        seq: this.clientInputSequenceNumber,
        timestamp: inputHandlerCommand.timestamp,
        moveForward: !!currentKeys['KeyW'] || !!currentKeys['ArrowUp'],
        moveBackward: !!currentKeys['KeyS'] || !!currentKeys['ArrowDown'],
        moveLeft: !!currentKeys['KeyA'] || !!currentKeys['ArrowLeft'],
        moveRight: !!currentKeys['KeyD'] || !!currentKeys['ArrowRight'],
        jump: !!currentKeys['Space'],
        descend: !!currentKeys['ShiftLeft'] || !!currentKeys['ControlLeft'],
        mouseDeltaX: inputHandlerCommand.mouseDeltaX || 0,
        mouseDeltaY: inputHandlerCommand.mouseDeltaY || 0,
      };

      // Check for active input before sending and adding to pending inputs
      const hasKeyMovement = playerInputCommand.moveForward || playerInputCommand.moveBackward || 
                             playerInputCommand.moveLeft || playerInputCommand.moveRight || 
                             playerInputCommand.jump || playerInputCommand.descend;
      const hasMouseMovement = playerInputCommand.mouseDeltaX !== 0 || playerInputCommand.mouseDeltaY !== 0;

      if (hasKeyMovement || hasMouseMovement) {
        this.pendingInputs.push({
          seq: this.clientInputSequenceNumber,
          keys: currentKeys, 
          cameraYaw: currentCameraYaw,
          currentIsFlying: flyingStatus,
          deltaTime: deltaTime, // deltaTime is for replaying this input
          rawCommand: playerInputCommand, 
        });
        this.wsClient.sendCommand(playerInputCommand);
      } else {
        // If no active input, we still need to reset mouse delta from inputHandler for the next frame.
        // However, we don't send a command or add to pending inputs if player is truly idle.
        // This is a simplification; a more robust system might send periodic idle updates
        // or always send input and have server ignore no-ops.
      }
      this.inputHandler.resetMouseDelta(); // Always reset delta from input handler

    }, 1000 / this.COMMAND_RATE);
  }

  private stopCommandLoop(): void {
    if (this.commandInterval) {
      clearInterval(this.commandInterval);
      this.commandInterval = null;
    }
  }
} 