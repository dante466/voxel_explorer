import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import type { IWorld } from 'bitecs';
import { PerspectiveCamera, Object3D } from 'three';
import { Transform } from '../world';
import { Camera, CameraTarget } from '../components/camera';
import { createCameraSystem } from './cameraSystem';
import { addObject3DToEntity, Object3DRef } from './transformSystem';

describe('CameraSystem', () => {
  let world: IWorld;
  let cameraSystem: ReturnType<typeof createCameraSystem>;
  let camera: PerspectiveCamera;
  let target: Object3D;

  beforeEach(() => {
    world = createWorld();
    cameraSystem = createCameraSystem(world);
    camera = new PerspectiveCamera(75, 1, 0.1, 1000);
    target = new Object3D();
  });

  it('should position camera with correct tilt and zoom', () => {
    // Create camera entity
    const cameraEntity = addEntity(world);
    addComponent(world, Camera, cameraEntity);
    addComponent(world, Transform, cameraEntity);
    addComponent(world, Object3DRef, cameraEntity);
    addObject3DToEntity(world, cameraEntity, camera);

    // Set up camera properties
    const targetEntity = addEntity(world);
    Camera.targetId[cameraEntity] = targetEntity;
    Camera.zoom[cameraEntity] = 50; // 50 meters zoom
    Camera.minZoom[cameraEntity] = 30;
    Camera.maxZoom[cameraEntity] = 70;
    Camera.lerpFactor[cameraEntity] = 1; // No lerp for testing
    Camera.tiltAngle[cameraEntity] = Math.PI / 9; // 20 degrees in radians

    // Create target entity
    addComponent(world, CameraTarget, targetEntity);
    addComponent(world, Transform, targetEntity);
    addComponent(world, Object3DRef, targetEntity);
    addObject3DToEntity(world, targetEntity, target);

    // Set target position
    Transform.position.x[targetEntity] = 0;
    Transform.position.y[targetEntity] = 0;
    Transform.position.z[targetEntity] = 0;

    // Run the system
    cameraSystem(world);

    // Check camera position
    // At 50m zoom and 20° tilt:
    // - Height should be: 50 * sin(20°) ≈ 17.1m
    // - Distance should be: 50 * cos(20°) ≈ 47.0m
    expect(camera.position.y).toBeCloseTo(17.1, 1);
    expect(camera.position.z).toBeCloseTo(47.0, 1);
    expect(camera.position.x).toBe(0); // Should be directly above target
  });
}); 