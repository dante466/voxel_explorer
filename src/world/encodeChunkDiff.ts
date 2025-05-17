export interface VoxelChange {
  voxelFlatIndex: number;
  newBlockId: number;
}

export function encodeChunkDiff(changes: VoxelChange[] | null): Uint8Array {
  if (!changes || changes.length === 0) {
    return new Uint8Array(0);
  }

  // Sort changes by flat index to find contiguous runs
  const sortedChanges = [...changes].sort((a, b) => a.voxelFlatIndex - b.voxelFlatIndex);

  const encoded: number[] = [];
  let i = 0;
  while (i < sortedChanges.length) {
    const startIndex = sortedChanges[i].voxelFlatIndex;
    const blockId = sortedChanges[i].newBlockId;
    let count = 1;
    let currentFlatIndex = startIndex;

    let j = i + 1;
    while (
      j < sortedChanges.length &&
      sortedChanges[j].voxelFlatIndex === currentFlatIndex + 1 &&
      sortedChanges[j].newBlockId === blockId &&
      count < 255
    ) {
      count++;
      currentFlatIndex = sortedChanges[j].voxelFlatIndex;
      j++;
    }

    // Add startIndex (Uint32 Little Endian)
    encoded.push(startIndex & 0xFF);
    encoded.push((startIndex >>> 8) & 0xFF);
    encoded.push((startIndex >>> 16) & 0xFF);
    encoded.push((startIndex >>> 24) & 0xFF);

    // Add count (Uint8)
    encoded.push(count);

    // Add blockId (Uint8)
    encoded.push(blockId);

    i = j; // Move to the start of the next potential run
  }

  return new Uint8Array(encoded);
} 