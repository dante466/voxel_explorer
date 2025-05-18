import * as flatbuffers from 'flatbuffers';
import { ServerSnapshot, PlayerState, Vec3 } from '../generated/flatbuffers/game-schema'; 

// Define a simple interface for the player data structure expected by the encoder
export interface PlayerData {
  id: string;
  position: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  yaw: number;
  lastAck: number;
  isFlying: boolean;
  isGrounded: boolean;
}

// Removed old helper functions as the new pattern uses Object API or direct construction

// From Triage Kit Step 4
export function encodeServerSnapshot(
  builder: flatbuffers.Builder,
  tick: number,
  playersData: readonly PlayerData[]
): Uint8Array {
  builder.clear();

  const playerOffsets = playersData.map(p => {
    const idOffset = builder.createString(p.id);
    const posOffset = Vec3.createVec3(builder, p.position.x, p.position.y, p.position.z);
    const velOffset = Vec3.createVec3(builder, p.vel.x, p.vel.y, p.vel.z);

    PlayerState.startPlayerState(builder);
    PlayerState.addId(builder, idOffset);
    PlayerState.addPosition(builder, posOffset);
    PlayerState.addVel(builder, velOffset);
    PlayerState.addYaw(builder, p.yaw);
    PlayerState.addLastAck(builder, p.lastAck);
    PlayerState.addIsFlying(builder, p.isFlying);
    PlayerState.addIsGrounded(builder, p.isGrounded);
    return PlayerState.endPlayerState(builder);
  });
  
  const playersVectorOffset = ServerSnapshot.createPlayersVector(builder, playerOffsets);

  ServerSnapshot.startServerSnapshot(builder);
  ServerSnapshot.addTick(builder, tick);        
  ServerSnapshot.addPlayers(builder, playersVectorOffset);
  const root = ServerSnapshot.endServerSnapshot(builder);

  builder.finish(root);
  return builder.asUint8Array();
}

export function decodeServerSnapshot(buf: Uint8Array): ServerSnapshot {
  return ServerSnapshot.getRootAsServerSnapshot(new flatbuffers.ByteBuffer(buf));
}

// --- Jest Test --- (Place this in a .test.ts file if you prefer, e.g., src/net/flat.test.ts)
// MOVED TO src/net/flat.test.ts 