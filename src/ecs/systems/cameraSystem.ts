import { defineQuery, defineSystem } from 'bitecs';
import type { IWorld } from 'bitecs';
import { PerspectiveCamera, Vector3 } from 'three';
import { Transform } from '../world';
import { Camera, CameraTarget } from '../components/camera';
import { Object3DRef, object3DMap } from './transformSystem';

// Query for camera entity
const cameraQuery = defineQuery([Camera, Transform, Object3DRef]);
// Query for camera target
const targetQuery = defineQuery([CameraTarget, Transform]);

// Helper function to lerp between two numbers
const lerp = (start: number, end: number, factor: number) => {
  return start + (end - start) * factor;
};

// Helper function to lerp between two Vector3s
const lerpVector3 = (start: Vector3, end: Vector3, factor: number) => {
  return new Vector3(
    lerp(start.x, end.x, factor),
    lerp(start.y, end.y, factor),
    lerp(start.z, end.z, factor)
  );
};

export const createCameraSystem = (world: IWorld) => {
  return defineSystem((world) => {
    // Get camera entity
    const cameras = cameraQuery(world);
    if (cameras.length === 0) return world;

    const cameraEntity = cameras[0];
    const cameraObject = object3DMap.get(cameraEntity) as PerspectiveCamera;
    if (!cameraObject) return world;

    // Get target entity
    const targetId = Camera.targetId[cameraEntity];
    const targets = targetQuery(world).filter(e => e === targetId);
    if (targets.length === 0) return world;

    const targetEntity = targets[0];
    const targetObject = object3DMap.get(targetEntity);
    if (!targetObject) return world;

    // Get current zoom and lerp factor
    const zoom = Camera.zoom[cameraEntity];
    const lerpFactor = Camera.lerpFactor[cameraEntity];
    const tiltAngle = Camera.tiltAngle[cameraEntity];

    // Calculate desired camera position
    // Start from target position
    const targetPos = new Vector3(
      Transform.position.x[targetEntity],
      Transform.position.y[targetEntity],
      Transform.position.z[targetEntity]
    );

    // Calculate camera position based on zoom and tilt
    const desiredPos = new Vector3(
      targetPos.x,
      targetPos.y + zoom * Math.sin(tiltAngle), // Height based on zoom and tilt
      targetPos.z + zoom * Math.cos(tiltAngle)  // Distance based on zoom and tilt
    );

    // Get current camera position
    const currentPos = new Vector3(
      Transform.position.x[cameraEntity],
      Transform.position.y[cameraEntity],
      Transform.position.z[cameraEntity]
    );

    // Lerp to desired position
    const newPos = lerpVector3(currentPos, desiredPos, lerpFactor);

    // Update camera position
    Transform.position.x[cameraEntity] = newPos.x;
    Transform.position.y[cameraEntity] = newPos.y;
    Transform.position.z[cameraEntity] = newPos.z;

    // Update camera object position
    cameraObject.position.copy(newPos);

    // Make camera look at target
    cameraObject.lookAt(targetPos);

    return world;
  });
}; 