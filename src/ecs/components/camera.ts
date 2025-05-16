import { defineComponent, Types } from 'bitecs';

// Component for entities that can be followed by the camera
export const CameraTarget = defineComponent({
  // Empty component - just a marker
});

// Component for the camera entity
export const Camera = defineComponent({
  // Target entity ID to follow
  targetId: Types.eid,
  // Current zoom level (in meters)
  zoom: Types.f32,
  // Min/max zoom constraints
  minZoom: Types.f32,
  maxZoom: Types.f32,
  // Lerp factor for smooth following (0-1)
  lerpFactor: Types.f32,
  // Tilt angle in radians
  tiltAngle: Types.f32
}); 