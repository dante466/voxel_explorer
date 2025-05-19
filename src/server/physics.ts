import * as RAPIER from '@dimforge/rapier3d-compat';

export interface PhysicsWorld {
  raw: RAPIER.World;
  step(): void;
  addRigidBody(body: RAPIER.RigidBodyDesc): RAPIER.RigidBody;
  removeRigidBody(body: RAPIER.RigidBody): void;
  addCollider(collider: RAPIER.ColliderDesc): RAPIER.Collider;
  removeCollider(collider: RAPIER.Collider): void;
}

let rapierInitialized = false;

export async function initRapier() {
  if (rapierInitialized) {
    console.log('[Physics] Rapier already initialized.');
    return;
  }
  try {
    console.log('[Physics] Initializing Rapier...');
    await RAPIER.init();
    rapierInitialized = true;
    console.log('[Physics] Rapier initialized SUCCESSFULLY.');
    if (RAPIER.version) {
      console.log(`[Physics] Rapier version: ${RAPIER.version()}`);
    } else {
      console.log('[Physics] RAPIER module loaded (version method not found, but init completed).');
  }
  } catch (error) {
    console.error('[Physics CRITICAL] Failed to initialize Rapier:', error);
    rapierInitialized = false;
    throw error;
  }
}

export function createPhysicsWorld(): PhysicsWorld {
  if (!rapierInitialized) {
    console.error('[Physics CRITICAL] Attempted to create physics world before Rapier was initialized! This should not happen.');
    throw new Error("Rapier not initialized. Cannot create physics world.");
  }
  console.log('[Physics] Creating new Rapier World...');
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  const world = new RAPIER.World(gravity);
  world.integrationParameters.dt = 1.0 / 30.0;
  console.log(`[Physics] New Rapier World created. World object: ${world ? 'Exists' : 'null'}. Gravity: ${world?.gravity?.y}`);

  return {
    raw: world,
    step() {
      world.step();
    },

    addRigidBody(bodyDesc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
      return world.createRigidBody(bodyDesc);
    },

    removeRigidBody(body: RAPIER.RigidBody) {
      world.removeRigidBody(body);
    },

    addCollider(colliderDesc: RAPIER.ColliderDesc): RAPIER.Collider {
      return world.createCollider(colliderDesc);
    },

    removeCollider(collider: RAPIER.Collider) {
      world.removeCollider(collider, true);
    }
  };
} 