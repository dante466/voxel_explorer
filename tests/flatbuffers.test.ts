import { describe, it, expect } from 'vitest';
import { Builder, ByteBuffer } from 'flatbuffers'; // Corrected import for flatbuffers
import * as GameSchema from '../src/generated/flatbuffers/game-schema';

// Directly use exported types after correcting the import paths and schema generation
const { PlayerInput, PlayerState, ServerSnapshot, Vec3 } = GameSchema;

// Helper to create a Vec3 (no change from previous, but ensure it uses the correct Vec3 from GameSchema)
function createFbVec3(builder: Builder, x: number, y: number, z: number): number {
  return Vec3.createVec3(builder, x, y, z);
}

// Encoder and Decoder for PlayerInput
function encodePlayerInput(builder: Builder, input: { seq: number, movementIntent: { x: number, y: number, z: number }, yaw: number, jumpPressed: boolean, isFlying: boolean }): number {
  const movementIntentOffset = createFbVec3(builder, input.movementIntent.x, input.movementIntent.y, input.movementIntent.z);
  
  PlayerInput.startPlayerInput(builder);
  PlayerInput.addSeq(builder, input.seq);
  PlayerInput.addMovementIntent(builder, movementIntentOffset);
  PlayerInput.addYaw(builder, input.yaw);
  PlayerInput.addJumpPressed(builder, input.jumpPressed);
  PlayerInput.addIsFlying(builder, input.isFlying);
  // PlayerInput.addShoot(builder, input.shoot); // shoot was removed from schema for now
  return PlayerInput.endPlayerInput(builder);
}

function decodePlayerInput(bytes: Uint8Array): GameSchema.PlayerInput | null {
  const buf = new ByteBuffer(bytes);
  return PlayerInput.getRootAsPlayerInput(buf);
}

// Encoder and Decoder for ServerSnapshot
function encodeServerSnapshot(builder: Builder, snapshot: { tick: number, players: Array<{ id: string, position: { x: number, y: number, z: number }, vel: { x: number, y: number, z: number }, yaw: number, lastAck: number, isFlying: boolean }> }): number {
  const playerStatesOffsets = snapshot.players.map(p => {
    const idOffset = builder.createString(p.id);
    const posOffset = createFbVec3(builder, p.position.x, p.position.y, p.position.z);
    const velOffset = createFbVec3(builder, p.vel.x, p.vel.y, p.vel.z);
    
    PlayerState.startPlayerState(builder);
    PlayerState.addId(builder, idOffset);
    PlayerState.addPosition(builder, posOffset);
    PlayerState.addVel(builder, velOffset);
    PlayerState.addYaw(builder, p.yaw);
    PlayerState.addLastAck(builder, p.lastAck);
    PlayerState.addIsFlying(builder, p.isFlying);
    return PlayerState.endPlayerState(builder);
  });

  const playersVectorOffset = ServerSnapshot.createPlayersVector(builder, playerStatesOffsets);
  
  ServerSnapshot.startServerSnapshot(builder);
  ServerSnapshot.addTick(builder, snapshot.tick);
  ServerSnapshot.addPlayers(builder, playersVectorOffset);
  return ServerSnapshot.endServerSnapshot(builder);
}

function decodeServerSnapshot(bytes: Uint8Array): GameSchema.ServerSnapshot | null {
  const buf = new ByteBuffer(bytes);
  return ServerSnapshot.getRootAsServerSnapshot(buf);
}


describe('FlatBuffer Encoding/Decoding M0-2', () => {
  it('should correctly encode and decode PlayerInput', () => {
    const builder = new Builder(1024);
    const originalInput = {
      seq: 123,
      movementIntent: { x: 1, y: 0, z: -1 }, // Y is 0 for XZ movement vector
      yaw: 0.75,
      jumpPressed: true,
      isFlying: false,
      // shoot: false, // shoot was removed from schema for now
    };

    const inputOffset = encodePlayerInput(builder, originalInput);
    builder.finish(inputOffset);
    const bytes = builder.asUint8Array();

    const decodedInput = decodePlayerInput(bytes);

    expect(decodedInput).not.toBeNull();
    if (!decodedInput) return; // type guard

    expect(decodedInput.seq()).toBe(originalInput.seq);
    expect(decodedInput.movementIntent()?.x()).toBe(originalInput.movementIntent.x);
    expect(decodedInput.movementIntent()?.y()).toBe(originalInput.movementIntent.y);
    expect(decodedInput.movementIntent()?.z()).toBe(originalInput.movementIntent.z);
    expect(decodedInput.yaw()).toBeCloseTo(originalInput.yaw);
    expect(decodedInput.jumpPressed()).toBe(originalInput.jumpPressed);
    expect(decodedInput.isFlying()).toBe(originalInput.isFlying);
  });

  it('should correctly encode and decode ServerSnapshot with multiple PlayerStates', () => {
    const builder = new Builder(1024);
    const originalSnapshot = {
      tick: 1000,
      players: [
        { id: 'player1', position: { x: 10, y: 20, z: 30 }, vel: {x: 1, y: 0, z: 0.5}, yaw: 1.57, lastAck: 120, isFlying: false },
        { id: 'player2', position: { x: -5, y: 15, z: 25 }, vel: {x: -0.2, y: 9.8, z: 0}, yaw: -0.5, lastAck: 122, isFlying: true },
      ],
    };

    const snapshotOffset = encodeServerSnapshot(builder, originalSnapshot);
    builder.finish(snapshotOffset);
    const bytes = builder.asUint8Array();

    const decodedSnapshot = decodeServerSnapshot(bytes);

    expect(decodedSnapshot).not.toBeNull();
    if (!decodedSnapshot) return; // type guard

    expect(decodedSnapshot.tick()).toBe(originalSnapshot.tick);
    expect(decodedSnapshot.playersLength()).toBe(originalSnapshot.players.length);

    for (let i = 0; i < originalSnapshot.players.length; i++) {
      const originalPlayer = originalSnapshot.players[i];
      const decodedPlayer = decodedSnapshot.players(i);
      expect(decodedPlayer).not.toBeNull();
      if(!decodedPlayer) continue;

      expect(decodedPlayer.id()).toBe(originalPlayer.id);
      expect(decodedPlayer.position()?.x()).toBe(originalPlayer.position.x);
      expect(decodedPlayer.position()?.y()).toBe(originalPlayer.position.y);
      expect(decodedPlayer.position()?.z()).toBe(originalPlayer.position.z);
      expect(decodedPlayer.vel()?.x()).toBeCloseTo(originalPlayer.vel.x);
      expect(decodedPlayer.vel()?.y()).toBeCloseTo(originalPlayer.vel.y);
      expect(decodedPlayer.vel()?.z()).toBeCloseTo(originalPlayer.vel.z);
      expect(decodedPlayer.yaw()).toBeCloseTo(originalPlayer.yaw);
      expect(decodedPlayer.lastAck()).toBe(originalPlayer.lastAck);
      expect(decodedPlayer.isFlying()).toBe(originalPlayer.isFlying);
    }
  });
}); 