import * as RAPIER from '@dimforge/rapier3d-compat'; // Using -compat for consistency
import { createPlayerBody } from '../../src/server/physics/playerFactory.js';

it('creates dynamic capsule', async () => {
  await RAPIER.init(); // Initialize from -compat
  const world = new RAPIER.World({ x:0,y:-9.81,z:0 });

  const { body, collider } = createPlayerBody(world, { x:0, y:2, z:0 });
  expect(body.isDynamic()).toBe(true); // Check if body is dynamic using isDynamic()
  expect(collider.shape).toBeDefined();        // basic sanity
  // Check shape type if possible and relevant (e.g., isCapsule() or type property)
  expect(collider.shape.type).toBe(RAPIER.ShapeType.Capsule);
}); 