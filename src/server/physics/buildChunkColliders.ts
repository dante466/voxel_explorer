import * as RAPIER from '@dimforge/rapier3d-compat';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  BLOCK_AIR,
  LODLevel
} from '../../shared/constants.js';
// import { getVoxel } from '../../shared/chunkUtils.js'; // REMOVED UNUSED IMPORT
import type { MatchState } from '../types'; // MatchState from src/server/types
import type { Chunk as ServerChunk } from '../world/types'; // Chunk from src/server/world/types

declare global {
  var LOG_COLLIDERS_FOR_CHUNK_KEY: string | null;
}
global.LOG_COLLIDERS_FOR_CHUNK_KEY = null;

function isBlockExposed(x: number, y: number, z: number, voxels: Uint8Array, area: number): boolean {
  // ADDED: Check if block below is air (as per Triage Kit 4-B)
  if (y > 0 && voxels[(y - 1) * area + z * CHUNK_SIZE_X + x] === BLOCK_AIR) return true;

  // Check -X
  if (x === 0 || voxels[y * area + z * CHUNK_SIZE_X + (x - 1)] === BLOCK_AIR) return true;
  // Check +X
  if (x === CHUNK_SIZE_X - 1 || voxels[y * area + z * CHUNK_SIZE_X + (x + 1)] === BLOCK_AIR) return true;
  // Check -Y
  if (y === 0 || voxels[(y - 1) * area + z * CHUNK_SIZE_X + x] === BLOCK_AIR) return true;
  // Check +Y
  if (y === CHUNK_SIZE_Y - 1 || voxels[(y + 1) * area + z * CHUNK_SIZE_X + x] === BLOCK_AIR) return true;
  // Check -Z
  if (z === 0 || voxels[y * area + (z - 1) * CHUNK_SIZE_X + x] === BLOCK_AIR) return true;
  // Check +Z
  if (z === CHUNK_SIZE_Z - 1 || voxels[y * area + (z + 1) * CHUNK_SIZE_X + x] === BLOCK_AIR) return true;
  return false;
}

/**
 * Enqueues functions to create greedy-meshed colliders for solid, exposed voxel groups in a chunk.
 * Returns the number of collider creation tasks enqueued.
 */
export function buildChunkColliders(
  world: RAPIER.World,
  chunkObject: ServerChunk,
  voxels: Uint8Array,
  cx: number,
  cz: number,
  matchState: MatchState,
  minedBlockLocalX?: number,
  minedBlockLocalY?: number,
  minedBlockLocalZ?: number
): number {
  const area = CHUNK_SIZE_X * CHUNK_SIZE_Z; // Placed area calculation earlier for the log

  // ADDED: Diagnostic log for the specific mined voxel
  const currentChunkKeyForLogHelper = `${cx},${cz},L${LODLevel.HIGH}`; // Assuming HIGH LOD for mining context
  if (
    global.LOG_COLLIDERS_FOR_CHUNK_KEY &&
    global.LOG_COLLIDERS_FOR_CHUNK_KEY === currentChunkKeyForLogHelper &&
    minedBlockLocalX !== undefined &&
    minedBlockLocalY !== undefined &&
    minedBlockLocalZ !== undefined
  ) {
    const minedBlockIndex = minedBlockLocalY * area + minedBlockLocalZ * CHUNK_SIZE_X + minedBlockLocalX;
    const minedBlockValue = voxels[minedBlockIndex];
    console.log(`[BuildColliders VoxelCheck (Mined Site)] Chunk(${cx},${cz}) at local (${minedBlockLocalX},${minedBlockLocalY},${minedBlockLocalZ}), Voxel value: ${minedBlockValue} (Expected AIR=${BLOCK_AIR})`);
  }

  let collidersCreatedThisCall = 0;
  const visited = new Uint8Array(voxels.length).fill(0);

  // Ensure colliderHandles is initialized as a simple array for storing handles of greedy meshes
  // This will be populated by the tasks in pendingColliders when they execute.
  // If this function is called for a rebuild, existing handles should have been cleared elsewhere.
  chunkObject.colliderHandles = []; 

  for (let y = 0; y < CHUNK_SIZE_Y; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const currentVoxelIndex = y * area + z * CHUNK_SIZE_X + x;
        if (visited[currentVoxelIndex] === 1 || voxels[currentVoxelIndex] === BLOCK_AIR) {
          continue;
        }

        // ADDED: Only start greedy meshing if the current block itself is exposed
        if (!isBlockExposed(x, y, z, voxels, area)) {
          visited[currentVoxelIndex] = 1; // Mark as visited so we don't re-check its exposure
          continue;
        }

        // Current block is solid, unvisited, AND exposed. Start greedy meshing.
        let currentWidth = 1;
        let currentHeight = 1;
        let currentDepth = 1;

        // 1. Expand Width (X-axis) along the starting (y,z) line
        for (let w = x + 1; w < CHUNK_SIZE_X; w++) {
          if (visited[y * area + z * CHUNK_SIZE_X + w] === 1 || voxels[y * area + z * CHUNK_SIZE_X + w] === BLOCK_AIR) {
            break;
          }
          currentWidth++;
        }

        // 2. Expand Depth (Z-axis) for the current (y) layer and established currentWidth
        for (let d = z + 1; d < CHUNK_SIZE_Z; d++) {
          let canExpandDepth = true;
          for (let w_scan = 0; w_scan < currentWidth; w_scan++) { // Check all blocks in the width
            if (visited[y * area + d * CHUNK_SIZE_X + (x + w_scan)] === 1 || voxels[y * area + d * CHUNK_SIZE_X + (x + w_scan)] === BLOCK_AIR) {
              if (voxels[y * area + d * CHUNK_SIZE_X + (x + w_scan)] === BLOCK_AIR) {
                // const logKey = global.LOG_COLLIDERS_FOR_CHUNK_KEY;
                // if (logKey && logKey === `${cx},${cz},L0`) {
                //      console.log(`[GreedyStopZ] Chunk(${cx},${cz}) StartBlk(${x},${y},${z}) stopped Z-expand at Abs(${x+w_scan},${y},${d}) due to AIR. CurrentDepth: ${currentDepth}`);
                // }
              }
              canExpandDepth = false;
              break;
            }
          }
          if (!canExpandDepth) {
            break;
          }
          currentDepth++;
        }

        // 3. Expand Height (Y-axis) for the established currentWidth and currentDepth
        for (let h = y + 1; h < CHUNK_SIZE_Y; h++) {
          let canExpandHeight = true;
          for (let d_scan = 0; d_scan < currentDepth; d_scan++) { // Check all blocks in the depth
            for (let w_scan = 0; w_scan < currentWidth; w_scan++) { // Check all blocks in the width
              if (visited[h * area + (z + d_scan) * CHUNK_SIZE_X + (x + w_scan)] === 1 || voxels[h * area + (z + d_scan) * CHUNK_SIZE_X + (x + w_scan)] === BLOCK_AIR) {
                if (voxels[h * area + (z + d_scan) * CHUNK_SIZE_X + (x + w_scan)] === BLOCK_AIR) {
                  // const logKey = global.LOG_COLLIDERS_FOR_CHUNK_KEY;
                  // if (logKey && logKey === `${cx},${cz},L0`) {
                  //      console.log(`[GreedyStopY] Chunk(${cx},${cz}) StartBlk(${x},${y},${z}) stopped Y-expand at Abs(${x+w_scan},${h},${z+d_scan}) due to AIR. CurrentHeight: ${currentHeight}`);
                  // }
                }
                canExpandHeight = false;
                break;
              }
            }
            if (!canExpandHeight) break;
          }
          if (!canExpandHeight) {
            break;
          }
          currentHeight++;
        }

        // Mark all blocks in this found cuboid as visited
        for (let h_idx = 0; h_idx < currentHeight; h_idx++) {
          for (let d_idx = 0; d_idx < currentDepth; d_idx++) {
            for (let w_idx = 0; w_idx < currentWidth; w_idx++) {
              visited[(y + h_idx) * area + (z + d_idx) * CHUNK_SIZE_X + (x + w_idx)] = 1; // Corrected visited marking index
            }
          }
        }
        
        // REMOVED the old cuboidIsExposed check section, as we now only start from exposed blocks
        // and the greedy expansion inherently creates a valid (solid) mesh.

        // if (cuboidIsExposed) { // This condition is now implicitly true
        const halfWidth = currentWidth / 2;
        const halfHeight = currentHeight / 2;
        const halfDepth = currentDepth / 2;

        // World position of the CENTER of the cuboid
        const wx = cx * CHUNK_SIZE_X + x + halfWidth;
        const wy = y + halfHeight; // World Y for block y=0 is at world Y=0.5 for its center
        const wz = cz * CHUNK_SIZE_Z + z + halfDepth;
        
        // Conditional logging based on global flag
        const currentChunkKeyForLog = `${cx},${cz},L0`; // LODLevel.HIGH is 0
        if (global.LOG_COLLIDERS_FOR_CHUNK_KEY && global.LOG_COLLIDERS_FOR_CHUNK_KEY === currentChunkKeyForLog) {
          console.log(`[MineRebuildColliderLog C(${cx},${cz})] Greedy Mesh: Start(x:${x},y:${y},z:${z}), Dims(${currentWidth}x${currentHeight}x${currentDepth}), WorldCenter(wx:${wx.toFixed(2)},wy:${wy.toFixed(2)},wz:${wz.toFixed(2)})`);
        }

        const colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);

        matchState.pendingColliders.push(() => {
          try {
            const collider = world.createCollider(colliderDesc.setTranslation(wx, wy, wz));
            // Add the new handle to the chunk's list of handles
            if (!chunkObject.colliderHandles) { // Ensure it exists, though it should from earlier init
              chunkObject.colliderHandles = [];
            }
            chunkObject.colliderHandles.push(collider.handle);

            // Server-side AABB check
            const colliderWorldPos = collider.translation();
            const calculatedMinY = colliderWorldPos.y - halfHeight; // halfHeight is from the cuboid's creation
            const calculatedMaxY = colliderWorldPos.y + halfHeight;
            const expectedMinY = y; // Local y of mesh start is world y of mesh bottom
            const expectedMaxY = y + currentHeight;
            // console.log(`[GreedyColliderDebug C(${cx},${cz})] Handle:${collider.handle} Task (x:${x},y:${y},z:${z}) Dims(${currentWidth}x${currentHeight}x${currentDepth}) ` +
            //             `ColliderCenterY: ${colliderWorldPos.y.toFixed(2)} (Set as: ${wy.toFixed(2)}) ` +
            //             `AABB MinY: ${calculatedMinY.toFixed(2)} (Exp: ${expectedMinY.toFixed(2)}), AABB MaxY: ${calculatedMaxY.toFixed(2)} (Exp: ${expectedMaxY.toFixed(2)})`);

          } catch (e) {
            console.error(`[Physics/ColliderQueue Greedy] Error creating block collider for chunk ${cx},${cz} (dims: ${currentWidth}x${currentHeight}x${currentDepth}):`, e);
          }
        });
        collidersCreatedThisCall++;
      }
    }
  }
  // console.log("[BuildColliders] Finished iterating voxels. Total colliders created this call for chunk", cx, cz, ":", collidersCreatedThisCall);
  return collidersCreatedThisCall;
}

// Public wrapper and queue logic removed for S2-1, will be part of S2-2 integration.