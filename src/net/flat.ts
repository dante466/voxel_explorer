import * as flatbuffers from 'flatbuffers';
import { StateSnapshot, PlayerStateT, Vec3T } from '../generated/flatbuffers/game-schema'; // Adjusted for Object API

// Removed old helper functions as the new pattern uses Object API or direct construction

// From Triage Kit Step 4
export function encodeStateSnapshot(
  builder: flatbuffers.Builder,
  stamp: bigint,
  players: readonly PlayerStateT[] // Using PlayerStateT from Object API
): Uint8Array {
  builder.clear(); // Clear builder state for fresh encoding

  // 1. Vec<Player>
  const playerOffsets = players.map(p => p.pack(builder)); // Use .pack() from Object API
  
  // Create the vector in reverse order as per FlatBuffers requirement
  StateSnapshot.startPlayersVector(builder, players.length);
  for (let i = players.length - 1; i >= 0; i--) {
    builder.addOffset(playerOffsets[i]!);
  }
  const playersVec = builder.endVector();

  // 2. Table
  StateSnapshot.startStateSnapshot(builder);
  StateSnapshot.addTimestamp(builder, stamp);        
  StateSnapshot.addPlayers(builder, playersVec);
  const root = StateSnapshot.endStateSnapshot(builder);

  builder.finish(root);
  return builder.asUint8Array(); // asUint8Array() is preferred for clarity
}

export function decodeStateSnapshot(buf: Uint8Array): StateSnapshot {
  return StateSnapshot.getRootAsStateSnapshot(new flatbuffers.ByteBuffer(buf));
}

// --- Jest Test --- (Place this in a .test.ts file if you prefer, e.g., src/net/flat.test.ts)
// MOVED TO src/net/flat.test.ts 