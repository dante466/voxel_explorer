import * as RAPIER from '@dimforge/rapier3d-compat';

export interface PhysicsWorld {
  raw: RAPIER.World;
  step(): void;
  addRigidBody(body: RAPIER.RigidBodyDesc): RAPIER.RigidBody;
  removeRigidBody(body: RAPIER.RigidBody): void;
  addCollider(collider: RAPIER.ColliderDesc): RAPIER.Collider;
  removeCollider(collider: RAPIER.Collider): void;
}

let rapier: typeof RAPIER;

export async function initRapier() {
  if (!rapier) {
    await RAPIER.init();
    rapier = RAPIER;
  }
  return rapier;
}

export function createPhysicsWorld(): PhysicsWorld {
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  const world = new rapier.World(gravity);

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