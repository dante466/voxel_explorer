import RAPIER from '@dimforge/rapier3d-compat';

export const PLAYER_HEIGHT = 1.8;   // metres
export const PLAYER_RADIUS = 0.4;   // metres
const HALF_HEIGHT = (PLAYER_HEIGHT - PLAYER_RADIUS * 2) / 2;   // capsule mid-segment

/** Spawns a dynamic capsule at `spawn` (Vec3). */
export function createPlayerBody(
  world: RAPIER.World,
  spawn: { x: number; y: number; z: number }
) {
  // 1. rigid body
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawn.x, spawn.y, spawn.z)
    .setCanSleep(false)
    .setCcdEnabled(true);

  const body = world.createRigidBody(rbDesc);

  // 2. collider (capsule aligned Y-up)
  const colDesc = RAPIER.ColliderDesc.capsule(HALF_HEIGHT, PLAYER_RADIUS)
    .setFriction(0.0)
    .setRestitution(0.0);

  const collider = world.createCollider(colDesc, body);
  
  console.log(`[physics] spawned player body handle ${body.handle} at (${spawn.x},${spawn.y},${spawn.z}).`); // Added for success criteria

  return { body, collider };
}

export function removePlayerPhysicsBody(
  world: RAPIER.World,
  bodyHandle: number | undefined | null,
  colliderHandle: number | undefined | null
): void {
  if (colliderHandle !== undefined && colliderHandle !== null) {
    const collider = world.getCollider(colliderHandle);
    if (collider) {
      world.removeCollider(collider, false); // false: do not wake up island
      console.log(`[physics] Removed player collider handle ${colliderHandle}`);
    } else {
      console.warn(`[physics] Attempted to remove player collider handle ${colliderHandle}, but it was not found.`);
    }
  }

  if (bodyHandle !== undefined && bodyHandle !== null) {
    const body = world.getRigidBody(bodyHandle);
    if (body) {
      world.removeRigidBody(body);
      console.log(`[physics] Removed player body handle ${bodyHandle}`);
    } else {
      console.warn(`[physics] Attempted to remove player body handle ${bodyHandle}, but it was not found.`);
    }
  } else if (colliderHandle === undefined || colliderHandle === null) {
    // Only log this if there wasn't even a collider handle to attempt removal with
    console.warn('[physics] removePlayerPhysicsBody called with no valid body or collider handle.');
  }
} 