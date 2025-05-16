import { createWorld, defineComponent, Types } from 'bitecs';

// Define the Transform component schema
// Using f32 for floating point numbers which is common for positions, rotations, scales.
export const Transform = defineComponent({
  position: {
    x: Types.f32,
    y: Types.f32,
    z: Types.f32,
  },
  rotation: { // Quaternion
    x: Types.f32,
    y: Types.f32,
    z: Types.f32,
    w: Types.f32,
  },
  scale: {
    x: Types.f32,
    y: Types.f32,
    z: Types.f32,
  }
});

// ECS World Factory function
export const createECSWorld = () => {
  const world = createWorld();

  // You can register components with the world if needed, 
  // but bitecs typically doesn't require explicit registration of components themselves,
  // only systems if you use its pipeline.
  // For now, just creating the world is enough for this task.

  // Initialize Transform default scale to 1,1,1 for new components if needed (example)
  // This is more of a utility function you might create elsewhere.
  // For now, the component definition is the key part.

  return world;
};

// Example of how you might pre-allocate for entities (optional, for optimization)
// const world = createWorld<IMyWorld>(10000); // Max 10000 entities
// export type IMyWorld = IWorld & {
//   // Define any world-specific properties if necessary
// } 