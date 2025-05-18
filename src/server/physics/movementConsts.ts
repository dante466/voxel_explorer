export const MAX_SPEED = 6;          // m/s
export const ACCEL      = 40;        // m/s²
export const DECEL      = 20;        // m/s² // This DECEL seems unused, server uses DAMPING_FACTOR
export const YAW_RATE   = 6;         // rad/s (max mouse turn; tweak later)
export const GROUND_DAMP = 0.90;     // Damping factor for grounded movement
export const AIR_DAMP    = 0.99;     // Damping factor for aerial movement (less damping) 