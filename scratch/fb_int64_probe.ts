import * as flatbuffers from 'flatbuffers';

// Local mini-schema in TS so we bypass code-gen.
class Probe {
  static startProbe(b: flatbuffers.Builder) { b.startObject(1); }
  static addTs(b: flatbuffers.Builder, v: bigint) { b.addFieldInt64(0, v, 0n); }
  static endProbe(b: flatbuffers.Builder) { return b.endObject(); }
  static getRoot(bb: flatbuffers.ByteBuffer) {
    // The way getRoot is used here is to get the table offset.
    // bb.position() is the start of the buffer for getRootAs functions.
    // The root object offset is read as an Int32 from this position.
    return bb.readInt32(bb.position()) + bb.position();
  }
  static ts(bb: flatbuffers.ByteBuffer, objOffset: number): bigint {
    // Field 0 in the table, so vtable offset is 4.
    const vtable_offset = 4;
    const field_offset_in_vtable = bb.__offset(objOffset, vtable_offset);
    return field_offset_in_vtable ? bb.readInt64(objOffset + field_offset_in_vtable) : 0n;
  }
}

const now = BigInt(Date.now());
const b = new flatbuffers.Builder();
Probe.startProbe(b);
Probe.addTs(b, now);
const root = Probe.endProbe(b);
b.finish(root);

const bb = new flatbuffers.ByteBuffer(b.asUint8Array());

// To correctly use Probe.getRoot, the ByteBuffer's position needs to be at the start of the root pointer.
// When a buffer is finished, the root table offset is usually at the very beginning if not size-prefixed.
// Or, more simply, the 'root' variable IS the offset of the table within the builder's buffer.
// We need to construct the ByteBuffer around the *finished* data.
// The offset 'root' is relative to the builder's internal buffer array when it was created.
// When we create 'bb' from b.asUint8Array(), 'root' is not directly usable as bb.position().
// However, flatbuffers.ByteBuffer.getRootAs (which we are bypassing) handles this.
// For this direct test, if 'root' is the offset of the table, and after finish() it's the root of the buffer,
// then the object starts at this 'root' offset from the beginning of the Uint8Array.

// The `getRoot` logic in the snippet needs to point to the start of the table.
// After `b.finish(root)`, the data in `b.asUint8Array()` has `root` as the offset to the main table.
// So, `Probe.getRoot(bb)` should effectively find this.
// The original `getRoot` was casting to number and had `bb.__indirect(bb.position())`.
// For a non-nested buffer finished this way, `bb.position()` is 0. `bb.readInt32(0)` gives the offset to the table.
// So `objOffset` for `Probe.ts` will be this table offset.

const tableOffset = bb.readInt32(0); // Root table offset from start of buffer
const decoded = Probe.ts(bb, tableOffset);

console.log({ now, decoded }); 