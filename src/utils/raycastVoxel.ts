import * as THREE from 'three';
import type { IWorld } from 'bitecs'; // Assuming ECS world might be needed for broad phase or entity checks
import type { ChunkManager } from '../world/ChunkManager';

export interface VoxelRaycastResult {
  position: THREE.Vector3;      // World position of the CENTER of the hit voxel
  normal: THREE.Vector3;        // Normal of the hit voxel face
  voxel: THREE.Vector3;         // Integer coordinates (x, y, z) of the hit voxel (corner)
  distance: number;             // Distance from ray origin to intersection point (approximate center or face)
}

/**
 * Casts a ray into the voxel world and returns information about the first hit voxel.
 * Uses the DDA (Digital Differential Analysis) algorithm.
 * 
 * @param rayOrigin The starting point of the ray in world coordinates.
 * @param rayDirection The normalized direction vector of the ray.
 * @param chunkManager The chunk manager to query for voxel data.
 * @param maxDistance The maximum distance the ray should travel.
 * @returns VoxelRaycastResult if a voxel is hit, otherwise null.
 */
export function raycastVoxel(
  rayOrigin: THREE.Vector3,
  rayDirection: THREE.Vector3,
  chunkManager: ChunkManager,
  maxDistance: number,
  // Optional: world: IWorld // If direct entity checks or broad phase needed later
): VoxelRaycastResult | null {

  let currentVoxelX = Math.floor(rayOrigin.x);
  let currentVoxelY = Math.floor(rayOrigin.y);
  let currentVoxelZ = Math.floor(rayOrigin.z);

  const stepX = rayDirection.x > 0 ? 1 : -1;
  const stepY = rayDirection.y > 0 ? 1 : -1;
  const stepZ = rayDirection.z > 0 ? 1 : -1;

  // Handle ray direction components being zero to avoid division by zero
  const tDeltaX = rayDirection.x === 0 ? Infinity : Math.abs(1 / rayDirection.x);
  const tDeltaY = rayDirection.y === 0 ? Infinity : Math.abs(1 / rayDirection.y);
  const tDeltaZ = rayDirection.z === 0 ? Infinity : Math.abs(1 / rayDirection.z);

  let tMaxX = (rayDirection.x > 0 ? (currentVoxelX + 1 - rayOrigin.x) : (rayOrigin.x - currentVoxelX)) * tDeltaX;
  let tMaxY = (rayDirection.y > 0 ? (currentVoxelY + 1 - rayOrigin.y) : (rayOrigin.y - currentVoxelY)) * tDeltaY;
  let tMaxZ = (rayDirection.z > 0 ? (currentVoxelZ + 1 - rayOrigin.z) : (rayOrigin.z - currentVoxelZ)) * tDeltaZ;

  // Ensure tMax values are non-negative if starting inside or on boundary
  if (rayDirection.x === 0) tMaxX = Infinity;
  if (rayDirection.y === 0) tMaxY = Infinity;
  if (rayDirection.z === 0) tMaxZ = Infinity;

  let distanceTraveled = 0;
  const hitNormal = new THREE.Vector3();
  let hitVoxelCoords: THREE.Vector3 | null = null;

  // First, check the voxel containing the ray's origin, if ray starts inside world bounds
  // This is important if the ray starts inside a block.
  // ChunkManager's hasBlock handles world coordinate bounds implicitly through chunk lookup.
  if (chunkManager.hasBlock(currentVoxelX, currentVoxelY, currentVoxelZ)) {
    // Ray starts inside a block. This is the hit.
    // Normal calculation in this case is tricky without knowing entry face, default or estimate.
    // For simplicity, if starting inside, we might not have a clear 'entry' normal.
    // Let's assume for now the DDA loop will find the *exit* face of this starting block if needed,
    // or we can treat this as a special case hit.
    // For highlighting, the voxel itself is key.
    hitVoxelCoords = new THREE.Vector3(currentVoxelX, currentVoxelY, currentVoxelZ);
    // Normal could be based on rayDirection, e.g., pointing opposite to ray entry from center.
    // For simplicity, if start inside, normal could be (0,0,0) or based on direction.
    // Let DDA step out to define normal more clearly.
    // For now, if we hit the starting block, we use its coords.
    // The DDA loop below will then step *out* of this block.
    // If we want to return this immediately:
    // return {
    //   position: new THREE.Vector3(currentVoxelX + 0.5, currentVoxelY + 0.5, currentVoxelZ + 0.5),
    //   normal: new THREE.Vector3(), // Undefined or approximate
    //   voxel: hitVoxelCoords,
    //   distance: 0,
    // };
  }

  while (distanceTraveled < maxDistance) {
    let steppedAxis: 'x' | 'y' | 'z' | null = null;

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        distanceTraveled = tMaxX;
        currentVoxelX += stepX;
        tMaxX += tDeltaX;
        hitNormal.set(-stepX, 0, 0);
        steppedAxis = 'x';
      } else {
        distanceTraveled = tMaxZ;
        currentVoxelZ += stepZ;
        tMaxZ += tDeltaZ;
        hitNormal.set(0, 0, -stepZ);
        steppedAxis = 'z';
      }
    } else {
      if (tMaxY < tMaxZ) {
        distanceTraveled = tMaxY;
        currentVoxelY += stepY;
        tMaxY += tDeltaY;
        hitNormal.set(0, -stepY, 0);
        steppedAxis = 'y';
      } else {
        distanceTraveled = tMaxZ;
        currentVoxelZ += stepZ;
        tMaxZ += tDeltaZ;
        hitNormal.set(0, 0, -stepZ);
        steppedAxis = 'z';
      }
    }
    
    if (distanceTraveled > maxDistance) break; // Exceeded max distance

    // Check the new voxel the ray has entered
    if (chunkManager.hasBlock(currentVoxelX, currentVoxelY, currentVoxelZ)) {
      hitVoxelCoords = new THREE.Vector3(currentVoxelX, currentVoxelY, currentVoxelZ);
      const hitPointCenter = new THREE.Vector3(currentVoxelX + 0.5, currentVoxelY + 0.5, currentVoxelZ + 0.5);
      
      // Calculate intersection point on the face using the normal and voxel corner
      // This is more accurate but complex. For now, using distanceTraveled for approximate hit distance.
      // A more precise intersection: plane defined by hitVoxelCoords and hitNormal, intersect ray with it.
      // Example: plane constant d = normal.dot(voxelCorner)
      // t = (d - normal.dot(rayOrigin)) / normal.dot(rayDirection)
      // intersection = rayOrigin + rayDirection * t
      // For now, distanceTraveled is to the *edge* of the voxel boundary crossed.

      return {
        position: hitPointCenter, // Center of the hit voxel for easy highlighting
        normal: hitNormal.clone(),
        voxel: hitVoxelCoords,
        distance: distanceTraveled, // Distance to the boundary that was crossed to enter this voxel
      };
    }

    // Safety break if tMax values become excessively large (e.g. all Infinity due to axis-aligned ray not hitting anything)
    if (tMaxX === Infinity && tMaxY === Infinity && tMaxZ === Infinity) {
        break;
    }
  }

  return null; // No voxel hit within maxDistance
}

// Helper to get mouse NDC (Normalized Device Coordinates -1 to 1)
export function getMouseNDC(clientX: number, clientY: number, window: Window): THREE.Vector2 {
  const ndc = new THREE.Vector2();
  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  return ndc;
}

// Helper to unproject mouse and get ray
export function getPickingRay(mouseNDC: THREE.Vector2, camera: THREE.PerspectiveCamera): THREE.Ray {
  const ray = new THREE.Ray();
  camera.updateMatrixWorld(); // Ensure camera matrix is up-to-date
  ray.origin.setFromMatrixPosition(camera.matrixWorld);
  ray.direction.set(mouseNDC.x, mouseNDC.y, 0.5).unproject(camera).sub(ray.origin).normalize();
  return ray;
}

// New helper to get a ray pointing from the center of the screen (camera's forward direction)
export function getCenterScreenRay(camera: THREE.PerspectiveCamera): THREE.Ray {
  const ray = new THREE.Ray();
  camera.updateMatrixWorld(); // Ensure camera matrix is up-to-date
  ray.origin.setFromMatrixPosition(camera.matrixWorld);
  // Get direction camera is looking
  camera.getWorldDirection(ray.direction); // This vector is already normalized
  return ray;
}

// Example usage (to be integrated into main.tsx or an input system)
/*
function handleMouseMoveForVoxelHighlight(event: MouseEvent, camera: THREE.PerspectiveCamera, chunkManager: ChunkManager, activeWindow: Window) {
  const mouseNDC = getMouseNDC(event.clientX, event.clientY, activeWindow);
  const pickRay = getPickingRay(mouseNDC, camera);
  
  const result = raycastVoxel(pickRay.origin, pickRay.direction, chunkManager, 100); // 100 = maxDistance
  
  if (result) {
    console.log('Hit voxel:', result.voxel, 'at distance:', result.distance, 'normal:', result.normal);
    // Update highlight box with result.voxel (needs to be center) or result.position and result.normal
  } else {
    // Hide highlight box
  }
}
*/ 