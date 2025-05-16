import { defineQuery, defineSystem, enterQuery, exitQuery, defineComponent, Types } from 'bitecs';
import type { IWorld } from 'bitecs';
import { Object3D } from 'three';
import { Transform } from '../world';

// Component to hold a reference to a Three.js Object3D
export const Object3DRef = defineComponent({
  value: Types.ui32, // Store the entity ID of the Object3D (or use a different approach if preferred)
});

// Map to store the actual Object3D instances (alternative to storing in a component)
// This is a common pattern when you need to store complex objects not easily serializable in bitecs components.
export const object3DMap = new Map<number, Object3D>();

// Query for entities with both Transform and Object3DRef
const transformQuery = defineQuery([Transform, Object3DRef]);
const enterTransformQuery = enterQuery(transformQuery);
const exitTransformQuery = exitQuery(transformQuery);

// System to sync Transform.position to Object3D.position
export const createTransformSystem = (world: IWorld) => {
  return defineSystem((world) => {
    // Handle new entities entering the query
    enterTransformQuery(world).forEach((entity) => {
      // You might need to get the Object3D instance here if not already set in the map
      // For now, assume it's set before the entity enters the query.
      const object3D = object3DMap.get(entity);
      if (!object3D) {
        console.warn(`Entity ${entity} has Object3DRef but no Object3D in map.`);
      }
    });

    // Update positions for all entities in the query
    transformQuery(world).forEach((entity) => {
      const object3D = object3DMap.get(entity);
      if (object3D) {
        object3D.position.x = Transform.position.x[entity];
        object3D.position.y = Transform.position.y[entity];
        object3D.position.z = Transform.position.z[entity];
        // Note: Rotation and scale are not synced in this basic system.
      }
    });

    // Handle entities exiting the query (e.g., cleanup if needed)
    exitTransformQuery(world).forEach((entity) => {
      // You might want to remove the Object3D from the map or scene here.
      // object3DMap.delete(entity);
    });

    return world;
  });
};

// Helper function to add an Object3D to an entity
export const addObject3DToEntity = (world: IWorld, entity: number, object3D: Object3D) => {
  // Add the Object3DRef component to the entity
  Object3DRef.value[entity] = entity; // Or use a different ID if needed
  // Store the actual Object3D instance in the map
  object3DMap.set(entity, object3D);
};

// Helper function to remove an Object3D from an entity
export const removeObject3DFromEntity = (world: IWorld, entity: number) => {
  // Remove the Object3DRef component
  // Note: bitecs doesn't have a direct 'removeComponent' function like some ECS libraries.
  // You typically handle this by not including the component in your queries or by resetting its values.
  // For now, we'll just remove it from the map.
  object3DMap.delete(entity);
}; 