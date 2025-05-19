import RAPIER from '@dimforge/rapier3d-compat';

export const PLAYER_HEIGHT = 1.8;   // metres
export const PLAYER_RADIUS = 0.4;   // metres
const HALF_HEIGHT = (PLAYER_HEIGHT - PLAYER_RADIUS * 2) / 2;   // capsule mid-segment
const PLAYER_MASS = 1.0; // Explicitly define player mass

/** Spawns a dynamic capsule at `spawn` (Vec3). */
export function createPlayerBody(
  world: RAPIER.World,
  spawn: { x: number; y: number; z: number }
) {
  console.log(`[PlayerFactory Pre-Create] Attempting to create body. World valid? ${world ? 'Yes' : 'No'}. World gravity: ${world?.gravity?.y}. Spawn: (${spawn.x},${spawn.y},${spawn.z})`);

  // 1. rigid body
  const translation = { x: spawn.x, y: spawn.y, z: spawn.z };
  const ccdEnabled = true;
  const additionalMass = PLAYER_MASS;

  const rbDesc = new RAPIER.RigidBodyDesc(RAPIER.RigidBodyType.Dynamic)
    .setTranslation(translation.x, translation.y, translation.z)
    .setCanSleep(false)
    .setCcdEnabled(ccdEnabled)
    .setAdditionalMass(additionalMass);

  console.log(`[PlayerFactory Pre-Create] RigidBodyDesc created. Parameters used -> Translation: (${translation.x}, ${translation.y}, ${translation.z}), CCD: ${ccdEnabled}, AdditionalMass: ${additionalMass}, CanSleep: false`);
  try {
    console.log(`[PlayerFactory Pre-Create] Number of rigid bodies in world before creation: ${world.bodies.len()}`);
    console.log(`[PlayerFactory Pre-Create] Number of colliders in world before creation: ${world.colliders.len()}`);
  } catch (e) {
    console.error('[PlayerFactory Pre-Create] Error getting world body/collider counts:', e);
  }

  console.log('[PlayerFactory Pre-Create] Calling world.createRigidBody...');
  const body = world.createRigidBody(rbDesc);

  if (!body) {
    let bodyDetails = 'body object is null or undefined';
    console.error(`[PlayerFactory CRITICAL] world.createRigidBody returned a falsy body object! Body details: ${bodyDetails}. Is world initialized correctly?`);
    return null; 
  }

  // 2. collider (capsule aligned Y-up)
  const colDesc = RAPIER.ColliderDesc.capsule(HALF_HEIGHT, PLAYER_RADIUS)
  // Temporarily use a ball collider for diagnostics - REVERTING THIS
  // const colDesc = RAPIER.ColliderDesc.ball(PLAYER_RADIUS)
    .setFriction(0.0)
    .setRestitution(0.0);

  console.log('[PlayerFactory Pre-Create] ColliderDesc created (Capsule). Calling world.createCollider...');
  const collider = world.createCollider(colDesc, body); // Pass the body instance itself

  if (!collider) {
    console.error(`[PlayerFactory CRITICAL] world.createCollider returned a falsy collider object! Removing potentially faulty rigid body (handle: ${body.handle}).`);
    world.removeRigidBody(body); // Clean up the created body if collider fails
    return null; // Signify failure
  }

  console.log(`[PlayerFactory Post-Create] Player body & collider OK. Body Handle: ${body.handle}, Type: ${body.bodyType()}, Mass After Capsule: ${body.mass()}. Collider Handle: ${collider.handle}, Parent Body Handle: ${collider.parent()?.handle}`);
  
  console.log(`[physics] SUCCESSFULLY spawned player body handle ${body.handle} and collider ${collider.handle} at (${spawn.x},${spawn.y},${spawn.z}).`);

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