import { defineComponent, Types, createWorld, type IWorld } from 'bitecs';

// --- Component Definitions ---

export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

export const Rotation = defineComponent({ // Euler angles
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

export const Velocity = defineComponent({
  vx: Types.f32,
  vy: Types.f32,
  vz: Types.f32,
});

// For PlayerInput, actions can be a bitmask for movement keys, jump, etc.
// Example bitmask for actions:
// 1 (00000001) = moveForward
// 2 (00000010) = moveBackward
// 4 (00000100) = moveLeft
// 8 (00001000) = moveRight
// 16 (00010000) = jump
// 32 (00100000) = descend (if applicable)
export const PlayerInput = defineComponent({
  actions: Types.ui8,       // Bitmask for actions
  mouseDeltaX: Types.f32,
  mouseDeltaY: Types.f32,
  dt: Types.f32,            // Delta time for which this input was active
  seq: Types.ui32,          // Input sequence number
});

// To link ECS entity with Rapier physics body handle/id
export const PhysicsBodyId = defineComponent({
  id: Types.ui32, // Assuming Rapier body handles can be stored as u32
});

// To link ECS entity with a network identifier (e.g., player ID from matchServer)
// If player IDs are strings like "player1", they'll need to be mapped to u32s
// or this component might need to store a reference differently.
// For now, assuming a numeric ID can be used or derived.
export const NetworkId = defineComponent({
  id: Types.ui32, 
});


// --- ECS World Factory ---

export interface ServerECSWorld extends IWorld {
  // Any custom world properties or methods can be defined here if needed
  time: {
    delta: number;
    elapsed: number;
    then: number;
  };
}

export function createServerECSWorld(): ServerECSWorld {
  const world = createWorld() as ServerECSWorld;

  // Register components (optional, but good practice for some bitecs features/extensions)
  // bitecs itself doesn't strictly require registration for basic use with defineComponent
  // but if we use pipelines or other utilities that need to know all components,
  // we might register them here. For now, it's not strictly necessary.
  
  world.time = { delta: 0, elapsed: 0, then: performance.now() };

  console.log('[ECS] Server ECS World created.');
  return world;
} 