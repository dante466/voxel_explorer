import { encodeChunkDiff, type VoxelChange } from './encodeChunkDiff';

describe('encodeChunkDiff', () => {
  it('should return an empty Uint8Array for no changes', () => {
    expect(encodeChunkDiff([])).toEqual(new Uint8Array([]));
    expect(encodeChunkDiff(null)).toEqual(new Uint8Array([]));
  });

  it('should encode a single change', () => {
    const changes: VoxelChange[] = [{ voxelFlatIndex: 100, newBlockId: 5 }];
    const expected = new Uint8Array([100, 0, 0, 0, 1, 5]);
    expect(encodeChunkDiff(changes)).toEqual(expected);
  });

  it('should encode a run of contiguous changes with the same blockId', () => {
    const changes: VoxelChange[] = [
      { voxelFlatIndex: 10, newBlockId: 7 },
      { voxelFlatIndex: 11, newBlockId: 7 },
      { voxelFlatIndex: 12, newBlockId: 7 },
    ];
    const expected = new Uint8Array([10, 0, 0, 0, 3, 7]);
    expect(encodeChunkDiff(changes)).toEqual(expected);
  });

  it('should handle unsorted input correctly', () => {
    const changes: VoxelChange[] = [
      { voxelFlatIndex: 11, newBlockId: 7 },
      { voxelFlatIndex: 10, newBlockId: 7 },
      { voxelFlatIndex: 12, newBlockId: 7 },
    ];
    const expected = new Uint8Array([10, 0, 0, 0, 3, 7]);
    expect(encodeChunkDiff(changes)).toEqual(expected);
  });

  it('should encode multiple separate runs and single changes', () => {
    const changes: VoxelChange[] = [
      { voxelFlatIndex: 10, newBlockId: 7 },
      { voxelFlatIndex: 11, newBlockId: 7 },
      { voxelFlatIndex: 15, newBlockId: 8 },
      { voxelFlatIndex: 20, newBlockId: 9 },
      { voxelFlatIndex: 21, newBlockId: 9 },
      { voxelFlatIndex: 22, newBlockId: 9 },
    ];
    const expected = new Uint8Array([
      10, 0, 0, 0, 2, 7,
      15, 0, 0, 0, 1, 8,
      20, 0, 0, 0, 3, 9,
    ]);
    expect(encodeChunkDiff(changes)).toEqual(expected);
  });

  it('should break runs if blockId changes', () => {
    const changes: VoxelChange[] = [
      { voxelFlatIndex: 10, newBlockId: 7 },
      { voxelFlatIndex: 11, newBlockId: 7 },
      { voxelFlatIndex: 12, newBlockId: 8 },
      { voxelFlatIndex: 13, newBlockId: 8 },
    ];
    const expected = new Uint8Array([
      10, 0, 0, 0, 2, 7,
      12, 0, 0, 0, 2, 8,
    ]);
    expect(encodeChunkDiff(changes)).toEqual(expected);
  });
  
  it('should break runs if indices are not contiguous', () => {
    const changes: VoxelChange[] = [
      { voxelFlatIndex: 10, newBlockId: 7 },
      { voxelFlatIndex: 11, newBlockId: 7 },
      { voxelFlatIndex: 13, newBlockId: 7 }, 
      { voxelFlatIndex: 14, newBlockId: 7 },
    ];
    const expected = new Uint8Array([
      10, 0, 0, 0, 2, 7,
      13, 0, 0, 0, 2, 7,
    ]);
    expect(encodeChunkDiff(changes)).toEqual(expected);
  });

  it('should handle max run length (255) and continue with a new run', () => {
    const makeChanges = (startIdx: number, len: number, id: number): VoxelChange[] => {
      const arr: VoxelChange[] = [];
      for (let k = 0; k < len; k++) {
        arr.push({ voxelFlatIndex: startIdx + k, newBlockId: id });
      }
      return arr;
    };
    const changes = makeChanges(10, 300, 3);
    // Expected: Run 1 (len 255): [10,0,0,0, 255,3]
    //           Run 2 (len 45):  [10+255,0,0,0, 45,3] -> [265,0,0,0, 45,3]
    //           265 = 0x0109 -> LE: 09, 01, 00, 00
    const expectedBytes = [
        10, 0, 0, 0, 255, 3,
        265 & 0xFF, (265 >>> 8) & 0xFF, (265 >>> 16) & 0xFF, (265 >>> 24) & 0xFF, 45, 3
    ];
    expect(encodeChunkDiff(changes)).toEqual(new Uint8Array(expectedBytes));
  });

  it('should correctly encode large flat indices (Uint32 LE)', () => {
    const changes1: VoxelChange[] = [{ voxelFlatIndex: 70000, newBlockId: 1 }];
    // 70000 = 0x00011170. LE bytes: 0x70, 0x11, 0x01, 0x00
    const expected1 = new Uint8Array([0x70, 0x11, 0x01, 0x00, 1, 1]);
    expect(encodeChunkDiff(changes1)).toEqual(expected1);

    const changes2: VoxelChange[] = [{ voxelFlatIndex: 131071, newBlockId: 2 }];
    // 131071 = 0x0001FFFF. LE bytes: 0xFF, 0xFF, 0x01, 0x00
    const expected2 = new Uint8Array([0xFF, 0xFF, 0x01, 0x00, 1, 2]);
    expect(encodeChunkDiff(changes2)).toEqual(expected2);
  });
  
  it('should process a list of mixed random-like changes without crashing or incorrect output', () => {
    const randomChanges: VoxelChange[] = [
      { voxelFlatIndex: 5, newBlockId: 1 },
      { voxelFlatIndex: 6, newBlockId: 1 },
      { voxelFlatIndex: 7, newBlockId: 2 },
      { voxelFlatIndex: 100, newBlockId: 2 },
      { voxelFlatIndex: 101, newBlockId: 2 },
      { voxelFlatIndex: 100000, newBlockId: 3 },
    ];
    // 100000 = 0x000186A0. LE: 0xA0, 0x86, 0x01, 0x00
    const expectedForRandom = new Uint8Array([
      5,0,0,0, 2,1,
      7,0,0,0, 1,2,
      100,0,0,0, 2,2,
      0xA0, 0x86, 0x01, 0x00, 1,3
    ]);
    expect(encodeChunkDiff(randomChanges)).toEqual(expectedForRandom);
  });
}); 