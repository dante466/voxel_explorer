import { defineQuery, defineSystem, type System } from 'bitecs';
import type { IWorld } from 'bitecs';
import * as THREE from 'three';
import { CameraTarget } from '../components/CameraTarget';
import { Transform } from '../world';
import { CameraMode } from '../types';
import type { ChunkManager } from '../../world/ChunkManager';
// object3DMap might be used later for target world position, but not for C3 skeleton directly
// import { object3DMap } from './transformSystem';

// Constants from the spec
export const TPS_DEFAULT_PITCH_RAD = THREE.MathUtils.degToRad(-20);
export const FPS_EYE_HEIGHT = 1.6;
export const DEFAULT_ZOOM = 3;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const LERP_POSITION_FACTOR = 0.25;
export const LERP_ROTATION_FACTOR = 0.15;
export const CAMERA_FOV = 70;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 1000;
const CAMERA_COLLISION_OFFSET = 0.5; // Offset from wall after collision
const MIN_CAMERA_LOCAL_Z = 0.4; // Minimum local Z distance for the camera from its pivot

// This enum is also defined in inputLookSystem.ts.
// Ideally, it would be in a shared types file, e.g., src/ecs/types.ts
// For now, ensure it's available for the CameraTarget component reference.
// If importing from inputLookSystem, ensure no circular dependencies arise.
// Re-defining here temporarily for clarity, or import if inputLookSystem is stable.
// export enum CameraMode { // REMOVE local definition
//   TPS = 0,
//   FPS = 1,
// }

export interface CameraSystemControls {
  system: System;
  camera: THREE.PerspectiveCamera;
  getPivot: () => THREE.Object3D;
  cleanup: () => void;
}

export function createCameraSystem(
  world: IWorld, 
  scene: THREE.Scene,
  initialAspect: number,
  gameWindow: Window,
  playerModelMesh: THREE.Mesh,
  chunkManager: ChunkManager
): CameraSystemControls {
  const gameCamera = new THREE.PerspectiveCamera(CAMERA_FOV, initialAspect, CAMERA_NEAR, CAMERA_FAR);

  const cameraPivot = new THREE.Object3D();
  scene.add(cameraPivot);
  cameraPivot.add(gameCamera); // Camera is child of pivot

  const cameraTargetQuery = defineQuery([CameraTarget, Transform]);

  // Variables to store target values for lerping
  const targetPivotPosition = new THREE.Vector3();
  const targetPivotQuaternion = new THREE.Quaternion();
  const targetCameraLocalPosition = new THREE.Vector3();
  const targetCameraLocalQuaternion = new THREE.Quaternion();
  const tempEuler = new THREE.Euler(); // Reusable Euler for quaternion conversion

  // For Raycasting
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();

  let tpsOcclusionCheckFrameCounter = 0;
  const TPS_OCCLUSION_CHECK_FRAME_INTERVAL = 3; // Check every 3 frames (was 2)

  // Persisted target for camera's local Z, considering occlusion
  let persistedTargetLocalZ = DEFAULT_ZOOM; // Initialize with default or player's initial if available
  // TODO: Consider initializing persistedTargetLocalZ with CameraTarget.zoom[playerEntity] if world is already populated.

  const cameraSystemLogic = defineSystem((currentWorld: IWorld) => {
    const entities = cameraTargetQuery(currentWorld);
    if (entities.length === 0) {
      return currentWorld;
    }
    const targetEid = entities[0];
    const targetMode = CameraTarget.mode[targetEid];

    if (targetMode === CameraMode.FPS) {
      playerModelMesh.visible = false;

      // Calculate target pivot position (player's exact position)
      targetPivotPosition.set(
        Transform.position.x[targetEid],
        Transform.position.y[targetEid],
        Transform.position.z[targetEid]
      );

      // Calculate target camera local position (eye height)
      targetCameraLocalPosition.set(0, FPS_EYE_HEIGHT, 0);

      // Calculate target pivot orientation (yaw)
      tempEuler.set(0, CameraTarget.yaw[targetEid], 0, 'YXZ');
      targetPivotQuaternion.setFromEuler(tempEuler);

      // Calculate target camera local orientation (pitch)
      tempEuler.set(CameraTarget.pitch[targetEid], 0, 0, 'YXZ');
      targetCameraLocalQuaternion.setFromEuler(tempEuler);
      
    } else if (targetMode === CameraMode.TPS) {
      playerModelMesh.visible = true;

      // Occlusion check runs based on interval
      tpsOcclusionCheckFrameCounter++;
      if (tpsOcclusionCheckFrameCounter >= TPS_OCCLUSION_CHECK_FRAME_INTERVAL) {
        tpsOcclusionCheckFrameCounter = 0;

        cameraPivot.updateMatrixWorld(); 
        rayOrigin.copy(cameraPivot.position); 

        const idealLocalCamPos = new THREE.Vector3(0, 0, CameraTarget.zoom[targetEid]);
        const idealWorldCamPos = idealLocalCamPos.applyMatrix4(cameraPivot.matrixWorld);
        rayDirection.subVectors(idealWorldCamPos, rayOrigin).normalize();

        const raycastDistance = CameraTarget.zoom[targetEid];
        // CRASH GUARD: Ensure raycastDistance is sensible
        if (raycastDistance >= MIN_CAMERA_LOCAL_Z && Number.isFinite(raycastDistance)) { 
            raycaster.set(rayOrigin, rayDirection);
            raycaster.far = raycastDistance + CAMERA_COLLISION_OFFSET; 
            raycaster.near = 0; 

            // CRASH GUARD: Ensure raycaster.far (nearbyRadius) is sensible
            const nearbyRadius = raycaster.far; 
            if (nearbyRadius > 0 && Number.isFinite(nearbyRadius)) {
                const chunkMeshes: THREE.Mesh[] = chunkManager.getNearbyChunkMeshes(cameraPivot.position, nearbyRadius);
                
                if (chunkMeshes && chunkMeshes.length > 0) { // CRASH GUARD: Ensure meshes exist
                    const intersects = raycaster.intersectObjects(chunkMeshes, false); 
                    if (intersects.length > 0) {
                        let closestHitDistance = raycastDistance;
                        for (const intersect of intersects) {
                            if (intersect.object === playerModelMesh) continue; 
                            if (intersect.distance < closestHitDistance) {
                                closestHitDistance = intersect.distance;
                            }
                        }
                        if (closestHitDistance < raycastDistance) {
                            const newOccludedLocalZ = closestHitDistance - CAMERA_COLLISION_OFFSET;
                            persistedTargetLocalZ = Math.max(MIN_CAMERA_LOCAL_Z, newOccludedLocalZ);
                        } else {
                            // No hit closer than desired zoom
                            persistedTargetLocalZ = CameraTarget.zoom[targetEid];
                        }
                    } else {
                        // No intersections found by raycaster
                        persistedTargetLocalZ = CameraTarget.zoom[targetEid];
                    }
                } else {
                    // No chunk meshes nearby or nearbyRadius was not sensible, default to player zoom
                    persistedTargetLocalZ = CameraTarget.zoom[targetEid];
                }
            } else {
                // Raycast distance not sensible, aim for player's desired zoom (or min if zoom is tiny)
                persistedTargetLocalZ = Math.max(MIN_CAMERA_LOCAL_Z, CameraTarget.zoom[targetEid]);
            }
        } else {
            // Raycast distance not sensible, aim for player's desired zoom (or min if zoom is tiny)
            persistedTargetLocalZ = Math.max(MIN_CAMERA_LOCAL_Z, CameraTarget.zoom[targetEid]);
        }
      } // End of frame interval occlusion check

      // Set the target local position for the camera using the persisted effective zoom
      targetCameraLocalPosition.set(0, 0, persistedTargetLocalZ);

      // Calculate target pivot position (player's eye-level position)
      targetPivotPosition.set(
        Transform.position.x[targetEid],
        Transform.position.y[targetEid] + FPS_EYE_HEIGHT, 
        Transform.position.z[targetEid]
      );

      // Calculate target pivot orientation (yaw)
      tempEuler.set(0, CameraTarget.yaw[targetEid], 0, 'YXZ');
      targetPivotQuaternion.setFromEuler(tempEuler);

      // Calculate target camera local orientation (pitch + TPS tilt)
      tempEuler.set(CameraTarget.pitch[targetEid] + TPS_DEFAULT_PITCH_RAD, 0, 0, 'YXZ');
      targetCameraLocalQuaternion.setFromEuler(tempEuler);
    }

    // Apply lerp/slerp
    cameraPivot.position.lerp(targetPivotPosition, LERP_POSITION_FACTOR);
    cameraPivot.quaternion.slerp(targetPivotQuaternion, LERP_ROTATION_FACTOR);

    gameCamera.position.lerp(targetCameraLocalPosition, LERP_POSITION_FACTOR);
    gameCamera.quaternion.slerp(targetCameraLocalQuaternion, LERP_ROTATION_FACTOR);

    return currentWorld;
  });

  // Initialize camera to a default state before first lerp if necessary
  // This helps avoid a jump from (0,0,0) on the very first frame.
  // We can get the initial player data to set this up.
  // This part can be tricky if playerEntity is not immediately available or its Transform not set.
  // For simplicity, we'll assume the initial direct set (before lerping was added) 
  // in the first few frames will be quick enough, or that initial transform is (0,0,0).
  // Alternatively, run a single direct set on the first entity found.
  if (cameraTargetQuery(world).length > 0) {
    const initialEid = cameraTargetQuery(world)[0];
    const initialMode = CameraTarget.mode[initialEid];
    if (initialMode === CameraMode.FPS) {
        cameraPivot.position.set(Transform.position.x[initialEid], Transform.position.y[initialEid], Transform.position.z[initialEid]);
        gameCamera.position.set(0, FPS_EYE_HEIGHT, 0);
        tempEuler.set(0, CameraTarget.yaw[initialEid], 0, 'YXZ');
        cameraPivot.quaternion.setFromEuler(tempEuler);
        tempEuler.set(CameraTarget.pitch[initialEid], 0, 0, 'YXZ');
        gameCamera.quaternion.setFromEuler(tempEuler);
    } else { // TPS initial
        cameraPivot.position.set(Transform.position.x[initialEid], Transform.position.y[initialEid] + FPS_EYE_HEIGHT, Transform.position.z[initialEid]);
        gameCamera.position.set(0, 0, CameraTarget.zoom[initialEid] || DEFAULT_ZOOM); // Use default zoom if not set
        tempEuler.set(0, CameraTarget.yaw[initialEid], 0, 'YXZ');
        cameraPivot.quaternion.setFromEuler(tempEuler);
        tempEuler.set(CameraTarget.pitch[initialEid] + TPS_DEFAULT_PITCH_RAD, 0, 0, 'YXZ');
        gameCamera.quaternion.setFromEuler(tempEuler);
    }
    // Also copy these to target values to avoid lerp on first frame from zero
    targetPivotPosition.copy(cameraPivot.position);
    targetPivotQuaternion.copy(cameraPivot.quaternion);
    targetCameraLocalPosition.copy(gameCamera.position);
    targetCameraLocalQuaternion.copy(gameCamera.quaternion);
  }

  const handleResize = () => {
    gameCamera.aspect = gameWindow.innerWidth / gameWindow.innerHeight;
    gameCamera.updateProjectionMatrix();
  };

  gameWindow.addEventListener('resize', handleResize);

  const cleanup = () => {
    gameWindow.removeEventListener('resize', handleResize);
    if (gameCamera.parent) {
      gameCamera.parent.remove(gameCamera);
    }
    scene.remove(cameraPivot); // This also removes gameCamera if it's still a child
    // Note: Three.js objects don't have a .clear() method.
    // Disposing geometries/materials would be done if the camera/pivot had custom ones.
    console.log('CameraSystem cleaned up.');
  };

  return {
    system: cameraSystemLogic,
    camera: gameCamera,
    getPivot: () => cameraPivot,
    cleanup,
  };
} 