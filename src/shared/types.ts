export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Player {
  id: string;
  bodyHandle?: number;        // Rapier dynamic body (REQUIRED)
  colliderHandle?: number;    // Rapier collider (REQUIRED)
  lastProcessedInputSeq?: number; // Made optional as per existing server type, can be firmed up
  // position: Vec3   <-- This field is now obsolete as position is derived from bodyHandle
  // entityId, rotation, velocity, ws? These are not in the S3-2 card's Player def.
}

// Potentially other shared types can go here in the future. 