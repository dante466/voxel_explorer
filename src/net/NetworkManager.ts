import { InputHandler } from './InputHandler';
import { WebSocketClient } from './WebSocketClient';
import type { ClientCommand, ConnectionState } from './types'; // Keep ConnectionState if used, remove if not
import { ClientCommandType } from './types';
import { type IWorld, addEntity, addComponent, hasComponent, removeEntity } from 'bitecs';
import { Transform } from '../ecs/world'; // Attempting import from world.ts
import { Object3DRef, object3DMap } from '../ecs/systems/transformSystem';
import { CameraTarget } from '../ecs/components/CameraTarget'; // For reading current camera yaw
import { 
    calculatePlayerMovement, 
    type PlayerMovementInputState, 
    // type PlayerMovementOutputState, // Not directly used by NetworkManager's public interface/pending types
    type PlayerMovementSystemControls 
} from '../ecs/systems/PlayerMovementSystem';
import { ChunkManager } from '../world/ChunkManager';
import * as THREE from 'three';
import { FIXED_DT_S } from '../time/fixedStep.js'; // Import FIXED_DT_S

// FlatBuffers imports
import * as flatbuffers from 'flatbuffers'; // Import flatbuffers namespace for Builder
import { GameSchema } from '../generated/flatbuffers/game.js';
// M1-1: Use PlayerInput and ServerSnapshot from the schema
const { ServerSnapshot, PlayerInput, Vec3: FbVec3 } = GameSchema; 
// M1-1: Update import to use decodeServerSnapshot
import { decodeServerSnapshot } from './flat.js'; 
import { ByteBuffer } from 'flatbuffers'; // Added for client-side decode test

// Local type for pending inputs, specific to NetworkManager's reconciliation needs
interface PendingInput {
  seq: number;
  // deltaTime: number; // Removed for C4-1
  numFixedTicks: number; // Added for C4-1: Number of FIXED_DT_S steps this input covers
  cameraYaw: number; // Absolute camera yaw at the time of input
  currentIsFlying: boolean;
  keys: { [key: string]: boolean };
  currentHorizontalVelocity: THREE.Vector2; // C1-1: Added to PendingInput
}

// S3-3: Interface for comparing input state to reduce network spam
interface PlayerInputStateForCompare {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  mouseYawDelta: number; // Store the actual delta, not the scaled value for FBS
}

export class NetworkManager {
  private inputHandler: InputHandler;
  private wsClient: WebSocketClient;

  private world: IWorld;
  private playerEntityId: number;
  private movementControls: PlayerMovementSystemControls;
  private chunkManager: ChunkManager;
  private scene: THREE.Scene;

  private pendingInputs: PendingInput[] = [];
  private commandLoopInterval: number | null = null;
  private lastSentInputSeq = 0;
  private localPlayerLastProcessedInputSeq: number = 0; // For local player
  private currentServerPlayerId: string | null = null;
  private serverAuthoritativeIsGrounded: boolean = false; // Triage Kit 1-A: Store server's grounded state
  private remotePlayerEntities: Map<string, number> = new Map();
  private remotePlayerModels: Map<string, THREE.Mesh> = new Map();
  private onServerInitialized: (() => void) | null = null;
  private lastSentPlayerInputState: PlayerInputStateForCompare | null = null; // S3-3: Added
  private snapshotErrorLogThrottle = 0; // DLOG-1: Counter for throttling error logs

  constructor(
    serverUrl: string, 
    world: IWorld, 
    playerEntityId: number, 
    movementControls: PlayerMovementSystemControls,
    chunkManager: ChunkManager,
    scene: THREE.Scene,
    onServerInitialized?: () => void
  ) {
    this.inputHandler = new InputHandler(); // Role to be reviewed, especially for mouseDelta
    this.world = world;
    this.playerEntityId = playerEntityId;
    this.movementControls = movementControls;
    this.chunkManager = chunkManager;
    this.scene = scene;
    this.onServerInitialized = onServerInitialized || null;

    this.wsClient = new WebSocketClient(serverUrl, (socket) => {
      if (this.chunkManager) {
        this.chunkManager.setSocket(socket);
      }
      this.startCommandLoop();
    });

    this.wsClient.onMessage = (data: string | ArrayBuffer) => {
      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data);
          this.handleServerMessage(message);
        } catch (error) {
          console.error('[NetworkManager] Error parsing JSON message:', error, data);
        }
      } else if (data instanceof ArrayBuffer) {
        try {
          const buffer = new Uint8Array(data);
          const snapshot = decodeServerSnapshot(buffer); // Returns GameSchema.ServerSnapshot

          // M1-1: Access ServerSnapshot fields directly instead of unpacking
          const serverTick = snapshot.tick(); // Example: Get tick
          const numPlayers = snapshot.playersLength();
          // console.log(`[NetMan StateUpdate] Received ServerSnapshot tick: ${serverTick}, numPlayers: ${numPlayers}`);

          const serverPlayerIds = new Set<string>();
          for (let i = 0; i < numPlayers; i++) {
            const playerState = snapshot.players(i); // Returns GameSchema.PlayerState
            if (!playerState) continue;

            const playerId = playerState.id();
            const playerPosition = playerState.position(); // Returns GameSchema.Vec3
            const playerVel = playerState.vel(); // N1-1: Get velocity from snapshot

            if (!playerId || !playerPosition || !playerVel) continue; // N1-1: Ensure playerVel is also present
            const currentIterationPlayerId = String(playerId); 
            const playerIsGrounded = playerState.isGrounded(); // Triage Kit 1-A: Read from snapshot

            serverPlayerIds.add(currentIterationPlayerId);

            if (currentIterationPlayerId === this.currentServerPlayerId) {
              // Local player update logic (remains largely the same, just sources data from accessors)
              this.serverAuthoritativeIsGrounded = playerIsGrounded; // Triage Kit 1-A: Store it
              this.movementControls.setServerGroundedState(this.serverAuthoritativeIsGrounded); // Triage Kit 1-A: Update movement system
              
              const serverPos = new THREE.Vector3(playerPosition.x(), playerPosition.y(), playerPosition.z());
              const serverVel = new THREE.Vector3(playerVel.x(), playerVel.y(), playerVel.z()); // Get full server velocity vector
              
              const clientPredPos = new THREE.Vector3(
                Transform.position.x[this.playerEntityId],
                Transform.position.y[this.playerEntityId],
                Transform.position.z[this.playerEntityId]
              );
              const predictionError = clientPredPos.distanceTo(serverPos);

              // Reverted: The enhanced logging and test-specific correction logic (if blocks based on predictionError) are removed.
              // Original logic to apply server's state directly:
              Transform.position.x[this.playerEntityId] = serverPos.x;
              Transform.position.y[this.playerEntityId] = serverPos.y;
              Transform.position.z[this.playerEntityId] = serverPos.z;
              
              // Also update client's local yVelocity and horizontalVelocity if server sends them and if it was original logic.
              // For now, assuming server position is the main thing to correct as per earlier state.
              // if (serverVel) { // Check if serverVel is available from snapshot
              //    this.movementControls.setCurrentYVelocity(serverVel.y);
              //    this.movementControls.setCurrentHorizontalVelocity(new THREE.Vector2(serverVel.x, serverVel.z));
              // }

              // Use playerState.lastAck() for sequence number processing
              // const lastProcessed = playerState.lastAck(); // Already got this as lastAckFromServer
              if (typeof playerState.lastAck() === 'number') {
                  this.localPlayerLastProcessedInputSeq = playerState.lastAck();
                  this.pendingInputs = this.pendingInputs.filter(
                      (input) => input.seq > this.localPlayerLastProcessedInputSeq
                  );
              }

              // Prediction replay logic
              const clientIsFlying = this.movementControls.isFlying(); 

              // N1-2: Replay Gating Condition
              // Triage Kit 1-A: Use serverAuthoritativeIsGrounded for replay decisions
              if ((this.serverAuthoritativeIsGrounded || clientIsFlying) && !(this.serverAuthoritativeIsGrounded && predictionError < 0.3)) {
                let yVelocityForReplay: number;
                let horizontalVelocityForReplay: THREE.Vector2 = new THREE.Vector2(); // Initialize

                // N1-1: Initialize replay velocities from server snapshot
                yVelocityForReplay = playerVel.y();
                horizontalVelocityForReplay.set(playerVel.x(), playerVel.z());
                
                // console.log(`[NetMan N1-1 ReplayStart] ServerVel Y: ${playerVel.y().toFixed(2)}, XZ: (${playerVel.x().toFixed(2)}, ${playerVel.z().toFixed(2)})`);

                // The old way of getting yVelocityForReplay:
                // if (clientIsFlying) {
                //   yVelocityForReplay = 0;
                // } else {
                //   yVelocityForReplay = this.movementControls.getCurrentYVelocity(); 
                // }
                // And horizontalVelocityForReplay was initialized from this.movementControls.getCurrentHorizontalVelocity() before the loop

                this.pendingInputs.forEach((input) => {
                  for (let i = 0; i < input.numFixedTicks; i++) {
                    const tempCurrentPosition = new THREE.Vector3(
                      Transform.position.x[this.playerEntityId],
                      Transform.position.y[this.playerEntityId],
                      Transform.position.z[this.playerEntityId]
                    );
                    const inputState: PlayerMovementInputState = {
                      currentPosition: tempCurrentPosition,
                      currentHorizontalVelocity: horizontalVelocityForReplay.clone(), // C1-1 Fix: Use and pass hVel for replay
                      currentYVelocity: yVelocityForReplay, 
                      currentIsFlying: input.currentIsFlying,
                      cameraYaw: input.cameraYaw, 
                      keys: input.keys,
                      chunkManager: this.chunkManager,
                      getIsOnGround: () => this.movementControls.isOnGround(), // Added to resolve TS error
                      autoStepEnabled: this.movementControls.getAutoStepState(), // ADDED
                    };
                    const outputState = calculatePlayerMovement(inputState); 
                    Transform.position.x[this.playerEntityId] = outputState.newPosition.x;
                    Transform.position.z[this.playerEntityId] = outputState.newPosition.z;
                    // Always apply the re-calculated Y position during replay
                    // This ensures the client's re-simulation fully updates its local Y
                    // before server state correction.
                    Transform.position.y[this.playerEntityId] = outputState.newPosition.y;
                    yVelocityForReplay = outputState.newYVelocity; 
                    horizontalVelocityForReplay.copy(outputState.horizontalVelocity); // C1-1 Fix: Update hVel for next replay step
                  }
                });
              } else if (this.serverAuthoritativeIsGrounded && predictionError < 0.3) {
                // console.log(`[NetMan N1-2 ReplaySkip] OnGround: ${this.serverAuthoritativeIsGrounded}, Error: ${predictionError.toFixed(3)}m. Skipping replay.`);
              }
            } else { // Remote player update logic
              let remoteEntityId = this.remotePlayerEntities.get(currentIterationPlayerId);
              const remotePlayerPos = playerState.position();
              // console.log(`[NetMan Debug] Remote player ${currentIterationPlayerId}: Server pos (${remotePlayerPos?.x().toFixed(2)}, ${remotePlayerPos?.y().toFixed(2)}, ${remotePlayerPos?.z().toFixed(2)})`);
              if (!remoteEntityId) {
                remoteEntityId = addEntity(this.world);
                addComponent(this.world, Transform, remoteEntityId);
                addComponent(this.world, Object3DRef, remoteEntityId);
                this.remotePlayerEntities.set(currentIterationPlayerId, remoteEntityId);
                // console.log(`[NetMan Debug] Remote player ${currentIterationPlayerId}: Created new entity ${remoteEntityId}`);
                if (this.scene && remotePlayerPos) {
                  const geometry = new THREE.CapsuleGeometry(0.4, 1.8 - 0.8, 4, 8);
                  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
                  const model = new THREE.Mesh(geometry, material);
                  this.scene.add(model);
                  object3DMap.set(remoteEntityId, model);
                  this.remotePlayerModels.set(currentIterationPlayerId, model);
                  // console.log(`[NetMan Debug] Remote player ${currentIterationPlayerId}: Added 3D model to scene.`);
                }
              } 
              if (remotePlayerPos) {
                Transform.position.x[remoteEntityId] = remotePlayerPos.x();
                Transform.position.y[remoteEntityId] = remotePlayerPos.y(); 
                Transform.position.z[remoteEntityId] = remotePlayerPos.z();
              }
              // console.log(`[NetMan Debug] Remote player ${currentIterationPlayerId} (entity ${remoteEntityId}): Updated Transform to (${Transform.position.x[remoteEntityId].toFixed(2)}, ${Transform.position.y[remoteEntityId].toFixed(2)}, ${Transform.position.z[remoteEntityId].toFixed(2)})`);
            }
          }
          this.remotePlayerEntities.forEach((entityId, playerId) => {
            if (!serverPlayerIds.has(playerId)) {
              if (hasComponent(this.world, Object3DRef, entityId)) {
                  const model = object3DMap.get(entityId) as THREE.Mesh; // Cast to THREE.Mesh
                  if (model && this.scene) {
                      this.scene.remove(model);
                      if (model.geometry) model.geometry.dispose();
                      if (model.material && typeof (model.material as THREE.Material).dispose === 'function') {
                          (model.material as THREE.Material).dispose();
                      }
                  }
                  object3DMap.delete(entityId);
              }
              removeEntity(this.world, entityId);
              this.remotePlayerEntities.delete(playerId);
              this.remotePlayerModels.delete(playerId);
            }
          });
        } catch (error) {
          console.error('[NetworkManager] Error decoding FlatBuffer ServerSnapshot:', error, data);
        }
      } else {
        console.warn('[NetworkManager] Received message of unknown type:', data);
      }
    };
  }

  public connect(): void {
    this.wsClient.connect();
  }

  private handleServerMessage(message: any): void {
    // Handle JSON messages (init, chunk responses, block updates, errors, playerLeft)
    if (this.chunkManager) {
      if (message.type === 'chunkResponse') {
        if (typeof message.cx === 'number' && 
            typeof message.cz === 'number' && 
            typeof message.voxels === 'string') {
          this.chunkManager.handleChunkResponse(
            message.cx, 
            message.cz, 
            message.voxels,
            message.lod,
            message.seq // Pass sequence number
          );
        } else { console.warn('[NetworkManager] Malformed chunkResponse (expected voxels as string):', message); }
        return;
      } else if (message.type === 'chunkResponseError') {
        if (typeof message.cx === 'number' && typeof message.cz === 'number' && typeof message.reason === 'string') {
          this.chunkManager.handleChunkResponseError(message.cx, message.cz, message.seq, message.reason); // Pass sequence number
        } else { console.warn('[NetworkManager] Malformed chunkResponseError:', message); }
        return;
      }
    }

    switch (message.type) {
      case 'init':
        this.currentServerPlayerId = message.playerId;
        console.log(`[NetworkManager] Player initialized with ID: ${this.currentServerPlayerId}`);
        if (message.initialPos && this.currentServerPlayerId === message.playerId) {
            Transform.position.x[this.playerEntityId] = message.initialPos.x;
            Transform.position.y[this.playerEntityId] = message.initialPos.y;
            Transform.position.z[this.playerEntityId] = message.initialPos.z;
            console.log(`[NetworkManager] Local player initial position set from server: (${message.initialPos.x}, ${message.initialPos.y}, ${message.initialPos.z})`);
        }

        if (message.state && message.state.players) {
          for (const playerIdVal in message.state.players) { // Use different var name from outer scope
            if (playerIdVal === this.currentServerPlayerId) continue;
            const pData = message.state.players[playerIdVal];
            if (pData && pData.id && pData.position) {
              let remoteEntityId = this.remotePlayerEntities.get(pData.id);
              if (!remoteEntityId) {
                remoteEntityId = addEntity(this.world);
                addComponent(this.world, Transform, remoteEntityId);
                addComponent(this.world, Object3DRef, remoteEntityId);
                this.remotePlayerEntities.set(pData.id, remoteEntityId);
                if (this.scene) {
                    const geometry = new THREE.CapsuleGeometry(0.4, 1.8 - 0.8, 4, 8);
                    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
                    const model = new THREE.Mesh(geometry, material);
                    model.position.set(pData.position.x, pData.position.y + (1.8/2) - 0.4, pData.position.z);
                    this.scene.add(model); 
                    object3DMap.set(remoteEntityId, model);
                    this.remotePlayerModels.set(pData.id, model);
                }
              }
              Transform.position.x[remoteEntityId] = pData.position.x;
              Transform.position.y[remoteEntityId] = pData.position.y;
              Transform.position.z[remoteEntityId] = pData.position.z;
            }
          }
        }
        if (this.onServerInitialized) {
          this.onServerInitialized();
        }
        break;
      case 'blockUpdate':
        if (typeof message.chunkX === 'number' && typeof message.chunkZ === 'number' && Array.isArray(message.rleBytes)) {
          const numericRleBytes: number[] = message.rleBytes.filter((b: any) => typeof b === 'number');
          if (numericRleBytes.length > 0) {
              this.chunkManager.applyRLEUpdate(message.chunkX, message.chunkZ, numericRleBytes)
                  .catch(error => console.error('[NetworkManager] Error applying RLE update:', error));
          }
        } else { console.warn('[NetworkManager] Malformed blockUpdate:', message); }
        break;
      case 'mineError':
      case 'placeError':
        console.error(`[NetworkManager] ${message.type} (seq: ${message.seq}, code: ${message.code}): ${message.reason}`);
        break;
      case 'playerLeft':
        const entityToRemove = this.remotePlayerEntities.get(message.playerId);
        if (entityToRemove) {
          if (hasComponent(this.world, Object3DRef, entityToRemove)) {
            const model = object3DMap.get(entityToRemove) as THREE.Mesh; // Cast to THREE.Mesh
            if (model && this.scene) {
                this.scene.remove(model);
                if (model.geometry) model.geometry.dispose();
                if (model.material && typeof (model.material as THREE.Material).dispose === 'function') {
                    (model.material as THREE.Material).dispose();
                }
            }
            object3DMap.delete(entityToRemove);
          }
          removeEntity(this.world, entityToRemove);
          this.remotePlayerEntities.delete(message.playerId);
          this.remotePlayerModels.delete(message.playerId);
          console.log(`[NetworkManager] Removed entity and model for player ${message.playerId}`);
        }
        break;
      default:
        // console.warn('[NetworkManager] Unhandled JSON message type:', message.type);
    }
  }

  // For sending JSON commands like MINE_BLOCK, PLACE_BLOCK
  public sendJsonCommand(type: ClientCommandType, payload: any = {}): void {
    if (!this.wsClient) return;
    this.lastSentInputSeq++; // Increment for any command sent for now
    const command: ClientCommand = { // This is the local ClientCommand type from ./types
      commandType: type,
      seq: this.lastSentInputSeq, // Include sequence number
      ...payload,
    };
    // Ensure this.wsClient.sendCommand stringifies the command
    this.wsClient.sendCommand(command); 
  }
  
  // Specific methods for mine/place to ensure correct payload structure
  public sendMineCommand(voxelX: number, voxelY: number, voxelZ: number): void {
    this.sendJsonCommand(ClientCommandType.MINE_BLOCK, { targetVoxelX: voxelX, targetVoxelY: voxelY, targetVoxelZ: voxelZ });
  }

  public sendPlaceCommand(voxelX: number, voxelY: number, voxelZ: number, blockId: number): void {
    this.sendJsonCommand(ClientCommandType.PLACE_BLOCK, { targetVoxelX: voxelX, targetVoxelY: voxelY, targetVoxelZ: voxelZ, blockId: blockId });
  }


  public startCommandLoop(): void {
    if (this.commandLoopInterval !== null) return;
    this.commandLoopInterval = window.setInterval(() => {
      const playerIdForCommand = this.currentServerPlayerId; // Used for logging, server extracts ID from connection

      if (!this.wsClient || !this.movementControls || this.wsClient.getSocket()?.readyState !== WebSocket.OPEN) {
        return;
      }

      const currentKeys = this.movementControls.getKeyStates();
      // this.inputHandler.resetMouseDelta(); // mouseDeltaX is no longer used for PlayerInput's yaw

      // M1-1: Get necessary states for PlayerInput
      const currentAbsoluteCameraYaw = CameraTarget.yaw[this.playerEntityId];
      const currentIsFlying = this.movementControls.isFlying();
      const jumpPressed = currentKeys['Space'] || false;
      const flyDownPressed = (currentKeys['ShiftLeft'] || currentKeys['ControlLeft']) || false; // Added

      // M1-1: Calculate movementIntent
      const intent = new THREE.Vector3();
      if (currentKeys['KeyW'] || currentKeys['ArrowUp']) intent.z -= 1;
      if (currentKeys['KeyS'] || currentKeys['ArrowDown']) intent.z += 1;
      if (currentKeys['KeyA'] || currentKeys['ArrowLeft']) intent.x -= 1;
      if (currentKeys['KeyD'] || currentKeys['ArrowRight']) intent.x += 1;

      // Normalize if necessary (to prevent faster diagonal movement)
      if (intent.lengthSq() > 1) {
        intent.normalize();
      }

      // M1-1: Send PlayerInput every tick (removed previous shouldSend optimization for now)
      this.lastSentInputSeq++;
      const fbBuilder = new flatbuffers.Builder(128);
      
      const movementIntentOffset = FbVec3.createVec3(fbBuilder, intent.x, intent.y, intent.z);

      PlayerInput.startPlayerInput(fbBuilder);
      PlayerInput.addSeq(fbBuilder, this.lastSentInputSeq);
      PlayerInput.addMovementIntent(fbBuilder, movementIntentOffset);
      PlayerInput.addYaw(fbBuilder, currentAbsoluteCameraYaw);
      PlayerInput.addJumpPressed(fbBuilder, jumpPressed);
      PlayerInput.addFlyDownPressed(fbBuilder, flyDownPressed); // Added
      PlayerInput.addIsFlying(fbBuilder, currentIsFlying);
      
      const cmdOffset = PlayerInput.endPlayerInput(fbBuilder);
      fbBuilder.finish(cmdOffset);
      const commandPayload = fbBuilder.asUint8Array();

      // console.log(`[Client Sent PlayerInput] Seq: ${this.lastSentInputSeq}, Yaw: ${currentAbsoluteCameraYaw.toFixed(2)}, Intent: (${intent.x},${intent.y},${intent.z})`);

      this.wsClient.sendBinaryCommand(commandPayload); 
      // this.lastSentPlayerInputState = currentStateForCompare; // Removed as PlayerInputStateForCompare is removed

      // Pending inputs still use individual key states and cameraYaw for client-side prediction
      // This is fine as calculatePlayerMovement can derive direction from these.
      this.pendingInputs.push({
        seq: this.lastSentInputSeq,
        // deltaTime: 1 / 30, // Removed for C4-1
        numFixedTicks: Math.round((1/30) / FIXED_DT_S), // C4-1: Calculate based on command loop rate and fixed DT
        cameraYaw: currentAbsoluteCameraYaw, 
        currentIsFlying: currentIsFlying, // Store isFlying at time of input
        keys: { ...currentKeys }, // Keep raw keys for prediction system
        currentHorizontalVelocity: this.movementControls.getCurrentHorizontalVelocity(), // C1-1 Fix: Store hVel in PendingInput
      });
    }, 1000 / 30); // Send at 30Hz
  }

  public stopCommandLoop(): void {
    if (this.commandLoopInterval !== null) {
      clearInterval(this.commandLoopInterval);
      this.commandLoopInterval = null;
    }
  }

  public disconnect(): void {
    this.stopCommandLoop();
    if (this.wsClient) {
      this.wsClient.disconnect();
    }
  }
} 