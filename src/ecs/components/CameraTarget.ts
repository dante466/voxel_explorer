import { defineComponent, Types } from 'bitecs';

// Component for entities that the camera will follow
export const CameraTarget = defineComponent({
  mode: Types.ui8, // 0 = TPS (Third Person), 1 = FPS (First Person)
  zoom: Types.f32,   // Zoom level in meters, only used in TPS mode
  pitch: Types.f32,  // Accumulated pitch angle in radians, only used in FPS mode
  yaw: Types.f32,    // Accumulated yaw angle in radians, only used in FPS mode
}); 