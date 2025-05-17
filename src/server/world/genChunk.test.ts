import { genChunk } from './genChunk';
import { generateClientChunk } from '../../world/noiseWorker.mock';
import { calcHeightMap } from './utils/heightmapUtils';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, AREA } from '../../shared/constants';

describe('genChunk (Flat Map)', () => {
  it('server and client (mocked with server logic) heightmaps should match for a flat map', () => {
    const seed = 12345; // Seed is ignored for flat map but kept for signature
    const chunkX = 0;
    const chunkZ = 0;

    const serverResult = genChunk(seed, chunkX, chunkZ);
    const clientMockResult = generateClientChunk(seed, chunkX, chunkZ);

    expect(serverResult.voxels).toBeInstanceOf(Uint8Array);
    expect(clientMockResult.voxels).toBeInstanceOf(Uint8Array);
    expect(serverResult.voxels.length).toBe(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);
    expect(clientMockResult.voxels.length).toBe(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);

    const serverHeightMap = calcHeightMap(serverResult.voxels);
    const clientHeightMap = calcHeightMap(clientMockResult.voxels);

    expect(serverHeightMap).toEqual(clientHeightMap);

    // For a flat map, all heightmap values should be the same (FLAT_GROUND_HEIGHT)
    // We need to know FLAT_GROUND_HEIGHT or derive it. Assuming it's 30 as used in genChunk.
    const expectedFlatHeight = 30; 
    for(let i = 0; i < AREA; i++) {
      expect(serverHeightMap[i]).toBe(expectedFlatHeight);
    }
  });

  it('should produce identical flat heightmaps regardless of seed', () => {
    const seed1 = 12345;
    const seed2 = 54321;
    const chunkX = 0;
    const chunkZ = 0;

    const serverResult1 = genChunk(seed1, chunkX, chunkZ);
    const serverResult2 = genChunk(seed2, chunkX, chunkZ);

    const serverHeightMap1 = calcHeightMap(serverResult1.voxels);
    const serverHeightMap2 = calcHeightMap(serverResult2.voxels);
    expect(serverHeightMap1).toEqual(serverHeightMap2); // Should be identical for a flat map
  });

  it('should produce identical flat heightmaps regardless of chunk coordinates', () => {
    const seed = 12345;
    const serverResult1 = genChunk(seed, 0, 0);
    const serverResult2 = genChunk(seed, 1, 5);
    const serverResult3 = genChunk(seed, -5, -2);

    const serverHeightMap1 = calcHeightMap(serverResult1.voxels);
    const serverHeightMap2 = calcHeightMap(serverResult2.voxels);
    const serverHeightMap3 = calcHeightMap(serverResult3.voxels);

    expect(serverHeightMap1).toEqual(serverHeightMap2);
    expect(serverHeightMap1).toEqual(serverHeightMap3);
    expect(serverHeightMap2).toEqual(serverHeightMap3);
  });
}); 