import * as RAPIER from '@dimforge/rapier3d-compat';
import { createPlayerBody } from '../../src/server/physics/playerFactory.js';

// The test provided in S3-2 card seems to be a basic test of body creation and removal,
// not directly testing the 'onConnection' logic of matchServer.ts.
// It's more of a direct test of Rapier world manipulation via the factory.

describe('Player Body Management in World', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('creates body on join and removes on disconnect (simulated)', async () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    // Simulate player joining: create a body
    const { body } = createPlayerBody(world, { x: 0, y: 50, z: 0 });
    expect(world.bodies.len()).toBe(1);
    const bodyHandle = body.handle; // Store handle for removal

    // Simulate player disconnecting: remove the body
    // Ensure we get the body object first if removeRigidBody expects an object
    const bodyToRemove = world.getRigidBody(bodyHandle);
    if (bodyToRemove) {
      world.removeRigidBody(bodyToRemove);
    } else {
      throw new Error('Test setup error: body to remove not found by handle');
    }
    expect(world.bodies.len()).toBe(0);
  });
}); 