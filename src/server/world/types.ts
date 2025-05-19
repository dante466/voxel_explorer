import { RigidBody } from '@dimforge/rapier3d-compat';
import { LODLevel } from '../../shared/constants'; // Assuming LODLevel is here
import type { WebSocket as ServerWebSocket } from 'ws'; // Import ServerWebSocket
// import { Entity } from "bitecs"; // bitecs eids are numbers

export interface PlayerServer {
  id: string; // WebSocket connection ID or a unique player identifier
  ws: ServerWebSocket;
  // Removed name, color, and lastInputTime as they are not currently used server-side
  // but can be re-added if needed for future features.
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // Euler angles
  linvel: { x: number; y: number; z: number }; // Linear velocity
  physicsBody: RigidBody | null;
  bodyHandle?: number; // Rapier body handle
  colliderHandle?: number; // Rapier collider handle
  lastInputSeq: number;
  isInitialized: boolean;
  entityId: number; // ECS entity ID on the server (bitecs eids are numbers)
  networkId: number; // Unique numeric network ID
  pendingChunks: Map<number /*seq*/, number /*timestamp*/>; // For server-side request throttling
  yaw?: number;
  isFlying?: boolean;
  lastInputHadMovementIntent?: boolean;
  lastProcessedInputSeq?: number; // client acks this, server sets it. Seems distinct from lastInputSeq from client.
  // lastInputHadMovementIntent?: boolean; // Added from matchServer player object context
  // lastProcessedInputSeq?: number; // Added from matchServer player object context
}

export interface Chunk {
  x: number; // Changed from chunkX
  z: number; // Changed from chunkZ
  lodLevel: LODLevel;
  data: Uint8Array; // Changed from getData() method
  heightmap: Uint8Array; // Changed from getHeightmap() method
  lastModified: number; // Added from ChunkGenerationQueue
  colliderHandles?: number[]; // Optional: if the server chunk tracks its Rapier colliders
  isGenerated: boolean; // Flag to indicate if voxel data is populated
  // isDirty: boolean; // isDirty is not on the object from ChunkGenerationQueue, removed for now
  lastAccessed: number; // Added from ChunkGenerationQueue

  // Methods removed as data is accessed directly as properties now
  // getData(): Uint8Array; 
  // getHeightmap(): Uint8Array; 
  // Add other relevant server-side chunk properties/methods if known
  // For example, if the server chunk itself has methods like setBlock, getBlock
} 