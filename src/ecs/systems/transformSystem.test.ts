import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import type { IWorld } from 'bitecs';
import { Object3D } from 'three';
import { Transform } from '../world';
import { createTransformSystem, addObject3DToEntity, Object3DRef } from './transformSystem';

describe('TransformSystem', () => {
  let world: IWorld;
  let transformSystem: ReturnType<typeof createTransformSystem>;
  let object3D: Object3D;

  beforeEach(() => {
    world = createWorld();
    transformSystem = createTransformSystem(world);
    object3D = new Object3D();
  });

  it('should sync Transform position to Object3D position', () => {
    // Create an entity
    const entity = addEntity(world);

    // Add both components
    addComponent(world, Transform, entity);
    addComponent(world, Object3DRef, entity);

    // Set Transform values
    Transform.position.x[entity] = 1;
    Transform.position.y[entity] = 2;
    Transform.position.z[entity] = 3;

    addObject3DToEntity(world, entity, object3D);

    // Run the system
    transformSystem(world);

    // Check if Object3D position is synced
    expect(object3D.position.x).toBe(1);
    expect(object3D.position.y).toBe(2);
    expect(object3D.position.z).toBe(3);
  });
}); 