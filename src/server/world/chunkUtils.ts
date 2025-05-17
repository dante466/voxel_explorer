/**
 * Generates a string key for a chunk based on its X and Z coordinates.
 * @param cx Chunk X coordinate
 * @param cz Chunk Z coordinate
 * @returns A string representation of the chunk key (e.g., "0,0")
 */
export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
} 