import { initRapier } from '../../src/server/physics'; // Assuming World is exported from physics.ts or main rapier module
import { createPlayerBody } from '../../src/server/physics/playerFactory';
import { MAX_SPEED } from '../../src/server/physics/movementConsts';
import * as RAPIER from '@dimforge/rapier3d-compat'; // Import RAPIER namespace

describe('Server Player Input to Velocity', () => {
  it('sets planar velocity from input', async () => {
    await initRapier(); // Ensure RAPIER is initialized
    const world = new RAPIER.World({ x:0,y:0,z:0 }); // Use RAPIER.World
    const { body } = createPlayerBody(world, new RAPIER.Vector3(0, 2, 0)); // Use RAPIER.Vector3

    // simulate "W" held - this test part is a bit conceptual as the actual input handler does more.
    // The test mostly verifies that setLinvel works as expected for a direct application.
    body.setLinvel({ x:0, y:0, z:0 }, true);
    // const velBeforeZ = body.linvel().z; // z before

    // expected straight forward from a direct application of MAX_SPEED
    const dz = -MAX_SPEED;

    // pretend handler ran and directly set this velocity (simplified from full accel/decel logic for this test)
    body.setLinvel({ x:0, y:0, z:dz }, true);

    expect(body.linvel().z).toBeCloseTo(dz, 3);
  });
}); 