import { describe, it, expect } from 'vitest';
import * as flatbuffers from 'flatbuffers'; // Needed for new Builder()
import { encodeStateSnapshot, decodeStateSnapshot } from './flat';
import { PlayerStateT, Vec3T, StateSnapshot } from '../generated/flatbuffers/game-schema'; // Import T types and StateSnapshot accessor class

// Mock data for testing
const mockPlayer1 = {
    id: "player1",
    position: { x: 1.0, y: 2.0, z: 3.0 },
    rotation: { x: 0.1, y: 0.2, z: 0.3 },
    lastProcessedInputSeq: 100,
};
const mockPlayer2 = {
    id: "player2",
    position: { x: 4.0, y: 5.0, z: 6.0 },
    rotation: { x: 0.4, y: 0.5, z: 0.6 },
    lastProcessedInputSeq: 102,
};

const mockSnapshotData = {
    players: [mockPlayer1, mockPlayer2],
    timestamp: BigInt(Date.now()),
};

describe('FlatBuffers StateSnapshot Encoding/Decoding (Triage Kit Pattern)', () => {
    it('encodes/decodes timestamp with empty players array', () => {
        const builder = new flatbuffers.Builder();
        const ts = BigInt(Date.now());
        const players: PlayerStateT[] = []; // Empty array of PlayerStateT

        const buf = encodeStateSnapshot(builder, ts, players);
        const snap: StateSnapshot = decodeStateSnapshot(buf); // decode now returns the StateSnapshot accessor class

        console.log("[Triage Test] Expected Timestamp:", ts.toString());
        console.log("[Triage Test] Decoded Timestamp:", snap.timestamp().toString());
        expect(snap.timestamp()).toEqual(ts);
        expect(snap.playersLength()).toEqual(0);
    });

    it('encodes/decodes with multiple players and timestamp', () => {
        const builder = new flatbuffers.Builder();
        const ts = BigInt(Date.now());

        const player1 = new PlayerStateT(
            "player1",
            new Vec3T(1.0, 2.0, 3.0),
            new Vec3T(0.1, 0.2, 0.3),
            100
        );
        const player2 = new PlayerStateT(
            "player2",
            new Vec3T(4.0, 5.0, 6.0),
            new Vec3T(0.4, 0.5, 0.6),
            102
        );
        const players: PlayerStateT[] = [player1, player2];

        const buf = encodeStateSnapshot(builder, ts, players);
        const snap: StateSnapshot = decodeStateSnapshot(buf);

        console.log("[Triage Test Multi] Expected Timestamp:", ts.toString());
        console.log("[Triage Test Multi] Decoded Timestamp:", snap.timestamp().toString());
        expect(snap.timestamp()).toEqual(ts);
        expect(snap.playersLength()).toEqual(players.length);

        // Optionally, verify player data if needed by unpacking
        const decodedPlayer1 = snap.players(0)?.unpack();
        const decodedPlayer2 = snap.players(1)?.unpack();

        expect(decodedPlayer1?.id).toEqual(player1.id);
        expect(decodedPlayer1?.position?.x).toEqual(player1.position?.x);
        // ... (add more checks for player data if desired)

        expect(decodedPlayer2?.id).toEqual(player2.id);

    });
}); 