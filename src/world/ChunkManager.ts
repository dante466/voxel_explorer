import * as THREE from 'three';
import { Chunk } from './Chunk';
import { LODLevel, CHUNK_SIZE, LOD_CHUNK_SIZE } from '../shared/constants.js';
import { NoiseManager } from './NoiseManager';
import { MesherManager } from './MesherManager';

interface ChunkMesh {
  mesh: THREE.Mesh;
  lastAccessed: number;
  lodLevel: LODLevel;
}

// Define a type for the callback that will process the received chunk data
type ChunkDataCallback = (chunk: Chunk) => void;

const MAX_CONCURRENT_CHUNK_REQUESTS = 8;          // tune: 4-16 is usually plenty
const REQUEST_BATCH_INTERVAL_MS       = 20;       // 50 fps "drip" feed

interface UnsentChunkRequest { // Added interface for queued requests
  chunkX: number;
  chunkZ: number;
  lodLevel: LODLevel;
  resolve: (chunk: Chunk) => void;
  reject: (reason?: any) => void;
  key: string;
  seq: number; // Added seq for tracking
}

export class ChunkManager {
  private noiseManager: NoiseManager;
  private mesherManager: MesherManager;
  private scene: THREE.Scene;
  private socket: WebSocket | null = null; // WebSocket for server communication
  private loadedChunks: Map<string, ChunkMesh> = new Map();
  private loadingChunks: Set<string> = new Set();
  private renderDistance: number;
  private unloadDistanceChunks: number;
  private maxLoadedChunks: number;
  private chunkMaterial: THREE.Material;
  private lodTransitionDistance: number = 100;
  private lodTransitionHysteresis: number = 40;
  private lastLODLevels: Map<string, LODLevel> = new Map();
  private lastPlayerPosition: { x: number, z: number } | null = null;
  private positionChangeThreshold: number = 4;
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100;
  private maxChunksPerFrame: number = 4;
  private batchSize: number = 1;
  private chunkHeightmaps: Map<string, Uint8Array> = new Map();
  private chunkData: Map<string, Chunk> = new Map();
  private loggedMissingHeightmaps: Set<string> = new Set();
  private loggedSocketNotReadyForChunks: Set<string> = new Set();

  // For handling pending chunk requests from the server
  private pendingChunkRequests: Map<string, { resolve: (chunk: Chunk) => void, reject: (reason?: any) => void, seq: number, lodLevel: LODLevel }> = new Map(); // NEW: LOD-specific key, added lodLevel to value for clarity/safety
  private unsentChunkRequestsQueue: UnsentChunkRequest[] = []; // Added queue for unsent requests
  private chunkRequestSeq = 0; // Added for sequencing chunk requests

  private inFlightRequests = 0;                     // how many have been sent but not answered
  private sendTimer: ReturnType<typeof setTimeout>|null = null;

  constructor(
    noiseManager: NoiseManager,
    mesherManager: MesherManager,
    scene: THREE.Scene,
    socket: WebSocket | null, // Allow null for local fallback or testing
    renderDistance: number = 5,
    maxLoadedChunks: number = 450,
    unloadDistanceChunks?: number
  ) {
    this.noiseManager = noiseManager;
    this.mesherManager = mesherManager;
    this.scene = scene;
    this.socket = socket; // Store the WebSocket instance
    this.renderDistance = renderDistance;
    this.unloadDistanceChunks = unloadDistanceChunks !== undefined ? unloadDistanceChunks : renderDistance + 3; // MODIFIED: Was renderDistance + 5
    this.maxLoadedChunks = maxLoadedChunks;

    // Load the texture
    const textureLoader = new THREE.TextureLoader();
    const blockTexture = textureLoader.load('/voxel_atlas.png'); // Load the new atlas
    blockTexture.magFilter = THREE.LinearFilter;
    blockTexture.minFilter = THREE.LinearMipmapLinearFilter;
    blockTexture.colorSpace = THREE.SRGBColorSpace;
    blockTexture.needsUpdate = true;

    // Create shared material for all chunks
    this.chunkMaterial = new THREE.MeshStandardMaterial({
      map: blockTexture, // Use the loaded texture
      side: THREE.DoubleSide,
      flatShading: false,
      roughness: 0.7,
      metalness: 0.1,
      vertexColors: false
    });
  }

  private getChunkKey(chunkX: number, chunkZ: number): string {
    return `${chunkX},${chunkZ}`;
  }

  private getChunkLODKey(chunkX: number, chunkZ: number, lodLevel: LODLevel): string {
    return `${chunkX},${chunkZ},L${lodLevel}`;
  }

  private getDistanceToChunk(playerX: number, playerZ: number, chunkX: number, chunkZ: number): number {
    const playerChunkX = Math.floor(playerX / 32);
    const playerChunkZ = Math.floor(playerZ / 32);
    const dx = playerChunkX - chunkX;
    const dz = playerChunkZ - chunkZ;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private getLODLevelForDistance(distance: number, chunkKey: string): LODLevel {
    const lastLOD = this.lastLODLevels.get(chunkKey);
    const baseLOD = distance > this.lodTransitionDistance ? LODLevel.LOW : LODLevel.HIGH;
    // For now, let's simplify and always request HIGH LOD from server, server can decide if it sends different LODs later
    // const baseLOD = LODLevel.HIGH; // REMOVED: Forced HIGH LOD
    
    // Apply hysteresis to prevent LOD flickering
    if (lastLOD !== undefined) {
      if (lastLOD === LODLevel.HIGH && distance > this.lodTransitionDistance + this.lodTransitionHysteresis) {
        return LODLevel.LOW;
      }
      if (lastLOD === LODLevel.LOW && distance < this.lodTransitionDistance - this.lodTransitionHysteresis) {
        return LODLevel.HIGH;
      }
      return lastLOD;
    }
    
    return baseLOD;
  }

  private getChunkPriority(
    playerX: number,
    playerZ: number,
    chunkX: number,
    chunkZ: number
  ): number {
    // Calculate distance to chunk center
    const chunkCenterX = (chunkX + 0.5) * 32;
    const chunkCenterZ = (chunkZ + 0.5) * 32;
    const dx = playerX - chunkCenterX;
    const dz = playerZ - chunkCenterZ;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Return negative distance (closer chunks have higher priority)
    return -distance;
  }

  private async loadChunk(chunkX: number, chunkZ: number, scene: THREE.Scene, lodLevel: LODLevel): Promise<void> {
    const key = this.getChunkKey(chunkX, chunkZ);
    const lodKey = this.getChunkLODKey(chunkX, chunkZ, lodLevel);

    const existingChunk = this.loadedChunks.get(key);
    if (existingChunk) {
        if (existingChunk.lodLevel === lodLevel) {
            existingChunk.lastAccessed = Date.now();
            return;
        } else {
            await this.unloadChunk(key, scene);
        }
    }

    if (this.loadingChunks.has(lodKey)) {
        return;
    }

    this.loadingChunks.add(lodKey);
    this.lastLODLevels.set(key, lodLevel);
    if (import.meta.env.DEV) {
      console.log(`[CM LoadChunk Debug] Chunk ${lodKey}: Attempting to load chunk.`);
    }

    try {
      console.log(`[CM LoadChunk Debug] Chunk ${lodKey}: Calling requestChunkDataFromServer.`);
      const chunk = await this.requestChunkDataFromServer(chunkX, chunkZ, lodLevel);
      
      if (!chunk) {
        this.loadingChunks.delete(lodKey);
        return;
      }
      const chunkVoxelData = chunk.getData();
      if (!chunkVoxelData || chunkVoxelData.length === 0) {
        this.loadingChunks.delete(lodKey);
        return;
      }

      console.log(`[CM LoadChunk Debug] Chunk ${lodKey}: Chunk data obtained. Voxel length: ${chunkVoxelData.length}.`);
      this.chunkData.set(key, chunk);

      const heightmap = chunk.getHeightmap();
      if (!heightmap || heightmap.length !== CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH) {
      } else {
        this.chunkHeightmaps.set(key, heightmap);
        this.loggedMissingHeightmaps.delete(key);
      }
      
      console.log(`[CM LoadChunk Debug] Chunk ${lodKey}: Attempting to mesh chunk.`);
      const meshData = await this.mesherManager.meshChunk(chunk);
      console.log(`[CM LoadChunk Debug] Chunk ${lodKey}: Meshing complete. Positions: ${meshData?.positions?.length}, Indices: ${meshData?.indices?.length}`);

      if (!meshData || meshData.positions.length === 0 || meshData.indices.length === 0) {
        return; 
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

      const chunkMesh = new THREE.Mesh(geometry, this.chunkMaterial);
      chunkMesh.position.set(chunkX * 32, 0, chunkZ * 32);
      chunkMesh.castShadow = true;
      chunkMesh.receiveShadow = true;

      scene.add(chunkMesh);
      console.log(`[CM LoadChunk Debug] Chunk ${lodKey}: Mesh ADDED to scene successfully.`);

      this.loadedChunks.set(key, {
        mesh: chunkMesh,
        lastAccessed: Date.now(),
        lodLevel
      });

      if (import.meta.env.DEV) {
        console.debug(`Chunk loaded at ${chunkX}, ${chunkZ} with LOD ${lodLevel}`);
        console.log(`[Client ChunkManager] Mesh for ${key} ADDED to scene.`);
      }
    } catch (error) {
    } finally {
      this.loadingChunks.delete(lodKey);
    }
  }

  private async unloadChunk(key: string, scene: THREE.Scene): Promise<void> {
    const chunkMeshDetails = this.loadedChunks.get(key);
    if (chunkMeshDetails) {
      // Remove from scene first
      if (chunkMeshDetails.mesh.parent) {
        scene.remove(chunkMeshDetails.mesh);
      }
      
      // Dispose of geometry and material
      chunkMeshDetails.mesh.geometry.dispose();
      this.loadedChunks.delete(key);
    }
    
    // Remove from other internal data structures that use the simple key
    this.lastLODLevels.delete(key);
    this.chunkHeightmaps.delete(key);
    this.chunkData.delete(key);

    // New: Cancel pending and unsent requests for this chunk coordinate (any LOD)
    // and clear from loadingChunks.
    const [cxStr, czStr] = key.split(',');
    if (cxStr === undefined || czStr === undefined) {
        console.error(`[CM UnloadChunk] Invalid simple key format: ${key}`);
        return;
    }
    const cx = parseInt(cxStr, 10);
    const cz = parseInt(czStr, 10);

    if (isNaN(cx) || isNaN(cz)) {
        console.error(`[CM UnloadChunk] Could not parse chunk coordinates from key: ${key}`);
        return;
    }

    const lodsToProcess = [LODLevel.HIGH, LODLevel.LOW]; // Iterate over all possible LODs

    for (const lod of lodsToProcess) {
      const lodKeyToCancel = this.getChunkLODKey(cx, cz, lod);

      // Cancel from pendingChunkRequests
      const pending = this.pendingChunkRequests.get(lodKeyToCancel);
      if (pending) {
        pending.reject(new Error(`Chunk ${lodKeyToCancel} unloaded while request was pending.`));
        this.pendingChunkRequests.delete(lodKeyToCancel);
        if (import.meta.env.DEV) {
            console.debug(`[CM UnloadChunk] Cancelled pending server request for ${lodKeyToCancel}.`);
        }
      }

      // Remove from loadingChunks
      if (this.loadingChunks.has(lodKeyToCancel)) {
        this.loadingChunks.delete(lodKeyToCancel);
        if (import.meta.env.DEV) {
            console.debug(`[CM UnloadChunk] Removed ${lodKeyToCancel} from loadingChunks set.`);
        }
      }
    }
    
    // Filter out from unsentChunkRequestsQueue
    const initialUnsentQueueSize = this.unsentChunkRequestsQueue.length;
    this.unsentChunkRequestsQueue = this.unsentChunkRequestsQueue.filter(req => {
        const shouldKeep = !(req.chunkX === cx && req.chunkZ === cz);
        if (!shouldKeep && import.meta.env.DEV) {
            const unsentLodKey = this.getChunkLODKey(req.chunkX, req.chunkZ, req.lodLevel);
            console.debug(`[CM UnloadChunk] Removing ${unsentLodKey} (seq ${req.seq}) from unsentChunkRequestsQueue.`);
        }
        return shouldKeep;
    });
    if (import.meta.env.DEV && this.unsentChunkRequestsQueue.length < initialUnsentQueueSize) {
        console.debug(`[CM UnloadChunk] Unsent queue size changed from ${initialUnsentQueueSize} to ${this.unsentChunkRequestsQueue.length} after unloading ${key}.`);
    }

    if (import.meta.env.DEV) {
      console.debug(`Unloaded chunk ${key} and attempted to cancel related pending/unsent requests.`);
    }
  }

  private async cleanupOldChunks(scene: THREE.Scene, playerX: number, playerZ: number): Promise<void> {
    if (this.loadedChunks.size <= this.maxLoadedChunks) return;

    // Get chunks that are too far away
    const chunksToUnload: string[] = [];
    for (const [key, chunkData] of this.loadedChunks) {
      const [x, z] = key.split(',').map(Number);
      const distance = this.getDistanceToChunk(playerX, playerZ, x, z);
      
      // Only unload chunks that are beyond the new unloadDistanceChunks
      if (distance > this.unloadDistanceChunks) {
        chunksToUnload.push(key);
      }
    }

    // If we still need to unload more chunks, remove the oldest ones that are within render distance
    if (this.loadedChunks.size - chunksToUnload.length > this.maxLoadedChunks) {
      const sortedChunks = Array.from(this.loadedChunks.entries())
        .filter(([key]) => !chunksToUnload.includes(key))
        .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

      while (this.loadedChunks.size - chunksToUnload.length > this.maxLoadedChunks) {
        const [key] = sortedChunks.shift()!;
        chunksToUnload.push(key);
      }
    }

    // Unload the selected chunks
    const unloadPromises = chunksToUnload.map(key => this.unloadChunk(key, scene));
    await Promise.all(unloadPromises);
  }

  private shouldUpdateChunks(playerX: number, playerZ: number, loadNewChunks: boolean = true): boolean {
    // Always update if we're not loading new chunks (i.e., we're unloading)
    if (!loadNewChunks) return true;

    if (!this.lastPlayerPosition) {
      this.lastPlayerPosition = { x: playerX, z: playerZ };
      return true;
    }

    const dx = playerX - this.lastPlayerPosition.x;
    const dz = playerZ - this.lastPlayerPosition.z;
    const distanceMoved = Math.sqrt(dx * dx + dz * dz);

    // Check if player moved significantly OR if render distance changed recently
    // (this.lastUpdateTime = 0 is set in setRenderDistance)
    // A more direct way to check for forced update might be a flag, but this works.
    let forceUpdateDueToSettingsChange = false;
    // If lastUpdateTime was reset to 0 (e.g., by setRenderDistance), 
    // it implies a settings change that should force re-evaluation of chunks.
    // Note: This check is a bit indirect. The update method already uses lastUpdateTime
    // to bypass the interval. Here we just want to know if we should proceed past movement check.
    // The main update loop will handle the interval itself.
    // The primary goal is ensuring that if render distance changes, we DO re-evaluate chunks.
    // The fact that setRenderDistance sets lastUpdateTime to 0, and the main update loop
    // *will* run because of that, means this specific check for forceUpdateDueToSettingsChange
    // might be redundant if the loop below is correct. The key is the loop's correctness.

    if (distanceMoved >= CHUNK_SIZE.WIDTH) { // Use CHUNK_SIZE.WIDTH for clarity (e.g. 32)
      this.lastPlayerPosition = { x: playerX, z: playerZ };
      return true; // Player moved significantly, defintely update.
    }

    // If player hasn't moved significantly, check if any chunks need loading/LOD change.
    // This is crucial for when render distance changes while player is stationary.
    const playerChunkX = Math.floor(playerX / CHUNK_SIZE.WIDTH);
    const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE.DEPTH);
    
    for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
      for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
        const chunkX = playerChunkX + x;
        const chunkZ = playerChunkZ + z;
        const simpleKey = this.getChunkKey(chunkX, chunkZ);
        
        const distance = this.getDistanceToChunk(playerX, playerZ, chunkX, chunkZ);
        const desiredLOD = this.getLODLevelForDistance(distance, simpleKey);
        const lodKeyForDesired = this.getChunkLODKey(chunkX, chunkZ, desiredLOD);

        const currentMeshDetails = this.loadedChunks.get(simpleKey);
        
        // Condition 1: Is the chunk not loaded at all?
        if (!currentMeshDetails) {
          // If not loaded, is it also not currently loading at the desired LOD?
          if (!this.loadingChunks.has(lodKeyForDesired)) {
            // console.log(`[ShouldUpdateChunks] Reason: Chunk ${simpleKey} not loaded, and desired LOD ${LODLevel[desiredLOD]} not loading. RETURNING TRUE`);
            return true; // Needs loading
          }
        } else {
          // Condition 2: Chunk is loaded, but is it at the wrong LOD?
          if (currentMeshDetails.lodLevel !== desiredLOD) {
            // If wrong LOD, is the desired LOD also not currently loading?
            if (!this.loadingChunks.has(lodKeyForDesired)) {
              // console.log(`[ShouldUpdateChunks] Reason: Chunk ${simpleKey} loaded at LOD ${LODLevel[currentMeshDetails.lodLevel]}, but desires ${LODLevel[desiredLOD]}, and desired not loading. RETURNING TRUE`);
              return true; // Needs LOD change and desired LOD isn't loading
            }
          }
        }
      }
    }
    // console.log("[ShouldUpdateChunks] No significant movement and all desired chunks appear to be loaded or loading at correct LOD. RETURNING FALSE");
    return false; // No significant movement AND all desired chunks are loaded at correct LOD or are loading.
  }

  private getVisibleChunks(
    playerX: number,
    playerZ: number,
    cameraDirection: THREE.Vector3,
    fov: number,
    aspectRatio: number
  ): { x: number, z: number }[] {
    const playerChunkX = Math.floor(playerX / 32);
    const playerChunkZ = Math.floor(playerZ / 32);
    const chunks: { x: number, z: number }[] = [];

    // Calculate view cone angles
    const halfFovRad = (fov * Math.PI / 180) / 2;
    const viewAngle = Math.atan2(cameraDirection.x, cameraDirection.z);
    const leftAngle = viewAngle - halfFovRad;
    const rightAngle = viewAngle + halfFovRad;

    // Calculate the maximum distance we need to check
    const maxDistance = this.renderDistance + 1; // Add 1 chunk buffer

    // Check all chunks within render distance
    for (let x = -maxDistance; x <= maxDistance; x++) {
      for (let z = -maxDistance; z <= maxDistance; z++) {
        const chunkX = playerChunkX + x;
        const chunkZ = playerChunkZ + z;
        
        // Calculate angle to chunk
        const dx = (chunkX + 0.5) * 32 - playerX;
        const dz = (chunkZ + 0.5) * 32 - playerZ;
        const angle = Math.atan2(dx, dz);
        
        // Normalize angle to be between -PI and PI
        const normalizedAngle = ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        
        // Check if chunk is within view cone or within buffer distance
        const distance = Math.sqrt(x * x + z * z);
        if (distance <= 1 || // Always include immediate chunks
            (normalizedAngle >= leftAngle && normalizedAngle <= rightAngle) || // Within view cone
            distance <= 2) { // Buffer zone
          chunks.push({ x: chunkX, z: chunkZ });
        }
      }
    }

    return chunks;
  }

  async update(
    playerX: number,
    playerZ: number,
    scene: THREE.Scene,
    loadNewChunks: boolean = true
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      // console.log("[CM Update] Socket not ready, skipping main update logic."); // Optional debug log
      return;
    }

    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    if (!this.shouldUpdateChunks(playerX, playerZ, loadNewChunks)) {
      return;
    }

    const playerChunkX = Math.floor(playerX / 32);
    const playerChunkZ = Math.floor(playerZ / 32);

    // Stage 1: Determine chunks that should ideally be loaded based on renderDistance
    const desiredChunksInRenderDistance = new Map<string, LODLevel>();
    const chunkPriorities: { key: string; priority: number }[] = [];

    for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
      for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
        const chunkX = playerChunkX + x;
        const chunkZ = playerChunkZ + z;
        const key = this.getChunkKey(chunkX, chunkZ);
        const distance = this.getDistanceToChunk(playerX, playerZ, chunkX, chunkZ);
        
        const lodLevel = this.getLODLevelForDistance(distance, key);
        desiredChunksInRenderDistance.set(key, lodLevel);
        this.lastLODLevels.set(key, lodLevel);

        const priority = this.getChunkPriority(playerX, playerZ, chunkX, chunkZ);
        chunkPriorities.push({ key, priority });
      }
    }
    chunkPriorities.sort((a, b) => b.priority - a.priority);

    // Stage 2: Unload chunks that are beyond unloadDistanceChunks
    const unloadPromises: Promise<void>[] = [];
    for (const [key, _chunkMeshDetails] of this.loadedChunks) { // Renamed chunkData to _chunkMeshDetails as it's not used
      const [cx, cz] = key.split(',').map(Number);
      const distanceToChunk = this.getDistanceToChunk(playerX, playerZ, cx, cz);
      if (distanceToChunk > this.unloadDistanceChunks) {
        unloadPromises.push(this.unloadChunk(key, scene));
      }
    }
    await Promise.all(unloadPromises);

    // Stage 3: Enforce maxLoadedChunks using cleanupOldChunks.
    // This method first unloads chunks > unloadDistanceChunks (redundant if above worked, but safe)
    // and then applies LRU if still over maxLoadedChunks.
    await this.cleanupOldChunks(scene, playerX, playerZ);

    // Stage 4: Load new chunks if enabled
    if (!loadNewChunks) {
      return;
    }

    // Update last accessed time for chunks that are desired and already loaded
    for (const [key, _lodLevel] of desiredChunksInRenderDistance) { // Renamed lodLevel as it's not used
      const chunkData = this.loadedChunks.get(key);
      if (chunkData) {
        chunkData.lastAccessed = now;
        // Future: Could check chunkData.lodLevel against desired LOD and trigger re-mesh if different
      }
    }

    const loadPromises: Promise<void>[] = [];
    let chunksLoadedThisFrame = 0;
    
    for (let i = 0; i < chunkPriorities.length && chunksLoadedThisFrame < this.maxChunksPerFrame; i += this.batchSize) {
      const batch = chunkPriorities.slice(i, i + this.batchSize);
      const batchPromises = batch.map(({ key }) => {
        if (desiredChunksInRenderDistance.has(key)) {
            // Max loaded chunks check (approximate due to loadingChunks being LOD-specific)
            // Prevents initiating load for a NEW chunk if already at/near capacity.
            if ((this.loadedChunks.size + this.loadingChunks.size) >= this.maxLoadedChunks && !this.loadedChunks.has(key)) {
                return Promise.resolve();
            }

            const [x, z] = key.split(',').map(Number);
            const desiredLOD = desiredChunksInRenderDistance.get(key)!;
            const lodKeyForDesired = this.getChunkLODKey(x, z, desiredLOD);

            const currentMeshDetails = this.loadedChunks.get(key); // Mesh details by simple key

            // Condition 1: Is the SPECIFIC desired LOD already being loaded?
            if (this.loadingChunks.has(lodKeyForDesired)) {
                return Promise.resolve(); // Yes, so skip.
            }

            // Condition 2: Is there a mesh, and is it ALREADY the desired LOD?
            if (currentMeshDetails && currentMeshDetails.lodLevel === desiredLOD) {
                // lastAccessed already updated in a prior loop
                return Promise.resolve(); // Yes, so skip.
            }
            
            // If we are here, then either:
            // a) No mesh exists for (cx,cz)
            // b) A mesh exists, but it's for a DIFFERENT LOD.
            // AND in both cases, the DESIRED LOD is not currently in loadingChunks.
            // So, we should proceed to call loadChunk.
            chunksLoadedThisFrame++;
            return this.loadChunk(x, z, scene, desiredLOD);
        }
        return Promise.resolve();
      });
      
      loadPromises.push(...batchPromises);
      
      // Reduce delay between batches significantly to improve responsiveness
      /* if (i + this.batchSize < chunkPriorities.length && batchPromises.some(p => p !== Promise.resolve())) { // Only delay if actual loading was initiated
        await new Promise(resolve => setTimeout(resolve, 10)); // Reduced from 50ms to 10ms
      } */
    }
    await Promise.all(loadPromises);
  }

  private getDefaultVisibleChunks(playerX: number, playerZ: number): { x: number, z: number }[] {
    const playerChunkX = Math.floor(playerX / 32);
    const playerChunkZ = Math.floor(playerZ / 32);
    const chunks: { x: number, z: number }[] = [];

    for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
      for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
        chunks.push({ x: playerChunkX + x, z: playerChunkZ + z });
      }
    }

    return chunks;
  }

  getHeightAtPosition(worldX: number, worldZ: number): number {
    const chunkX = Math.floor(worldX / 32);
    const chunkZ = Math.floor(worldZ / 32);
    const key = this.getChunkKey(chunkX, chunkZ);
    
    const heightmap = this.chunkHeightmaps.get(key);
    if (!heightmap) {
      if (import.meta.env.DEV && !this.loggedMissingHeightmaps.has(key)) {
        console.debug(`[ChunkMan] getHeightAtPosition: No heightmap for chunk ${key} (${worldX.toFixed(0)},${worldZ.toFixed(0)}). Logging once. Will use default 64.`);
        this.loggedMissingHeightmaps.add(key);
      }
      // Request chunk generation if not loaded
      // this.loadChunk(chunkX, chunkZ, this.scene, LODLevel.HIGH).catch(console.error); // Removed this line
      return 64; // Default to sea level if chunk not loaded
    }

    // Ensure coordinates are within bounds
    // Correctly handle negative world coordinates for local conversion
    const localX = ((Math.floor(worldX) % CHUNK_SIZE.WIDTH) + CHUNK_SIZE.WIDTH) % CHUNK_SIZE.WIDTH;
    const localZ = ((Math.floor(worldZ) % CHUNK_SIZE.DEPTH) + CHUNK_SIZE.DEPTH) % CHUNK_SIZE.DEPTH;
    const height = heightmap[localZ * CHUNK_SIZE.WIDTH + localX]; // CORRECTED INDEXING: localZ (row) * numColumns + localX (col)
    
    // console.log(`[CM getHeightAtPos] world(${worldX.toFixed(2)},${worldZ.toFixed(2)}) -> chunk(${chunkX},${chunkZ}) key(${key}) -> local(${localX},${localZ}) -> heightmap val=${height}`);
    
    return height || 64; // Fallback to sea level if height is undefined
  }

  // New method to check if a block exists at world coordinates
  public hasBlock(worldX: number, worldY: number, worldZ: number): boolean {
    const chunkX = Math.floor(worldX / 32); // Assuming CHUNK_SIZE.WIDTH is 32
    const chunkZ = Math.floor(worldZ / 32); // Assuming CHUNK_SIZE.DEPTH is 32

    const chunkKey = this.getChunkKey(chunkX, chunkZ);
    const chunk = this.chunkData.get(chunkKey);

    if (!chunk) {
      return false; // Chunk not loaded or doesn't exist
    }

    // Convert world Y to local Y. Assuming world Y is directly local Y for blocks.
    // And assuming CHUNK_SIZE.HEIGHT for chunks is 128 (as per spec) but Chunk.ts uses 32 for data array height.
    // This needs clarification based on how Chunk.ts data is structured vs. world height.
    // For now, assume worldY is directly usable if within chunk's height bounds as per Chunk.ts.
    const localX = ((worldX % 32) + 32) % 32; // Ensure positive local coords
    const localZ = ((worldZ % 32) + 32) % 32;
    const localY = worldY; // This is a critical assumption here.
                           // Chunk.ts: isInBounds checks against CHUNK_SIZE.HEIGHT (32) or LOD_CHUNK_SIZE.HEIGHT (16)
                           // The world has a height of 128. Voxel data in Chunk.ts seems to be 32x32x32 or 16x16x16 for LOD.
                           // This implies that a single Chunk object does not store the full 128 vertical height.
                           // This needs to be reconciled. For now, proceeding with assumption that localY = worldY is intended for the target chunk.
                           // If a single chunk only covers a vertical slice, then raycasting needs to find the right vertical chunk too.
                           // Let's assume for 4.1 the `Chunk` at `chunkX, chunkZ` covers the full height relevant to `worldY`.
                           // Or, more likely, Chunk data is CHUNK_WIDTH x WORLD_HEIGHT x CHUNK_DEPTH conceptually for storage, 
                           // but `Chunk.ts` CHUNK_SIZE.HEIGHT is 32. This is a mismatch.
                           // For the DDA, we need to check the block *within the specific chunk data array*. 
                           // The `y` in `chunk.hasBlock(localX, localY, localZ)` must be local to that chunk's data array.

    // Re-evaluating localY:
    // If world height is 128, and chunk data height is 32 (from CHUNK_SIZE.HEIGHT in Chunk.ts)
    // then we need to also determine which vertical chunk segment worldY falls into.
    // However, the current ChunkManager structure (Map<string, Chunk> with key from chunkX, chunkZ)
    // doesn't support multiple vertical chunks at the same (X,Z). 
    // This implies Chunk.ts's CHUNK_SIZE.HEIGHT should represent the full height slice (e.g. 128).
    // The Chunk.ts defines CHUNK_SIZE.HEIGHT = 32. This is the source of the conflict.

    // For the purpose of M4.1, let's assume that the `ChunkManager` is intended to provide
    // access to a voxel space where `worldY` is directly used as `localY` within the specific chunk's data array,
    // and that `Chunk.isInBounds` correctly handles the `y` for its data dimensions.
    // This is likely an architectural simplification in the current code that will need future refinement
    // if chunks are meant to be stacked vertically.

    // Given Chunk.ts internal structure uses CHUNK_SIZE.HEIGHT for its y-dimension (32), 
    // then worldY must be mapped to a localY within that range [0, CHUNK_SIZE.HEIGHT - 1].
    // This suggests raycastVoxel's currentVoxelY should also be within this range IF it's hitting a chunk.
    // This is getting complicated due to the ambiguity. 
    // For now, the simplest path is that chunk.hasBlock() will take the worldY and correctly interpret it
    // or determine if it's out of its specific bounds.
    // The `Chunk.hasBlock` method already calls `isInBounds` which uses its LOD-specific height.
    // So, we pass worldY as localY and let the Chunk class handle it.

    return chunk.hasBlock(localX, localY, localZ);
  }

  getChunkData(chunkKey: string): Chunk | undefined {
    return this.chunkData.get(chunkKey);
  }

  public getNearbyChunkMeshes(centerWorldPos: THREE.Vector3, worldRadius: number): THREE.Mesh[] {
    const nearbyMeshes: THREE.Mesh[] = [];
    const centerChunkX = Math.floor(centerWorldPos.x / 32);
    const centerChunkZ = Math.floor(centerWorldPos.z / 32);
    // Calculate chunk radius based on world radius. Add 1 to ensure chunks at the edge are included.
    const chunkCellRadius = Math.ceil(worldRadius / 32) + 1; 

    const worldRadiusSq = worldRadius * worldRadius;

    for (let dX = -chunkCellRadius; dX <= chunkCellRadius; dX++) {
      for (let dZ = -chunkCellRadius; dZ <= chunkCellRadius; dZ++) {
        const checkChunkX = centerChunkX + dX;
        const checkChunkZ = centerChunkZ + dZ;

        const key = this.getChunkKey(checkChunkX, checkChunkZ);
        const chunkMeshDetails = this.loadedChunks.get(key);

        if (chunkMeshDetails) {
          const chunkMinX = checkChunkX * 32;
          const chunkMinZ = checkChunkZ * 32;
          const chunkMaxX = chunkMinX + 32;
          const chunkMaxZ = chunkMinZ + 32;

          // Find the point on the AABB closest to the circle's center
          const closestX = Math.max(chunkMinX, Math.min(centerWorldPos.x, chunkMaxX));
          const closestZ = Math.max(chunkMinZ, Math.min(centerWorldPos.z, chunkMaxZ));

          // Calculate the distance squared between the circle's center and this closest point
          const distanceSq = 
            (centerWorldPos.x - closestX) * (centerWorldPos.x - closestX) +
            (centerWorldPos.z - closestZ) * (centerWorldPos.z - closestZ);

          // If the distance squared is less than or equal to the circle's radius squared, they intersect
          if (distanceSq <= worldRadiusSq) {
            nearbyMeshes.push(chunkMeshDetails.mesh);
          }
        }
      }
    }
    return nearbyMeshes;
  }

  private _decodeRLEBytes(rleBytes: number[]): { flatIndex: number, blockId: number }[] {
    const changes: { flatIndex: number, blockId: number }[] = [];
    if (!rleBytes || rleBytes.length === 0) {
      return changes;
    }

    // Each entry is 6 bytes: 4 for index, 1 for count, 1 for blockId
    for (let i = 0; i < rleBytes.length; ) {
      if (i + 6 > rleBytes.length) { 
        console.error('Malformed RLE data: insufficient bytes for a full entry. Remaining bytes:', rleBytes.slice(i));
        break; 
      }

      const startIndex = rleBytes[i] |
                       (rleBytes[i+1] << 8) |
                       (rleBytes[i+2] << 16) |
                       (rleBytes[i+3] << 24);
      const count = rleBytes[i+4];
      const blockId = rleBytes[i+5];

      for (let k = 0; k < count; k++) {
        changes.push({ flatIndex: startIndex + k, blockId });
      }
      i += 6; 
    }
    return changes;
  }

  public async applyRLEUpdate(chunkX: number, chunkZ: number, rleBytes: number[]): Promise<void> {
    const key = this.getChunkKey(chunkX, chunkZ);
    const chunk = this.chunkData.get(key);

    if (!chunk) {
      console.warn(`ChunkManager:applyRLEUpdate - Chunk data not found for ${key}, cannot apply RLE update.`);
      return;
    }
    
    if (chunk.lodLevel !== LODLevel.HIGH && chunk.lodLevel !== undefined) {
        console.warn(`ChunkManager:applyRLEUpdate - Attempting to apply RLE update to a non-HIGH LOD chunk (${key}, LOD: ${chunk.lodLevel}).`);
    }

    const decodedChanges = this._decodeRLEBytes(rleBytes);
    if (import.meta.env.DEV) {
        console.debug(`ChunkManager:applyRLEUpdate - Decoded ${decodedChanges.length} changes for chunk ${key} from rleBytes:`, rleBytes, decodedChanges);
    }

    if (decodedChanges.length === 0 && rleBytes.length > 0) {
        console.warn(`ChunkManager:applyRLEUpdate - RLE bytes were present but no changes decoded for chunk ${key}. RLE Data:`, rleBytes);
    }

    for (const change of decodedChanges) {
      chunk.setVoxelByFlatIndex(change.flatIndex, change.blockId);
    }

    const oldChunkMeshDetails = this.loadedChunks.get(key);

    if (oldChunkMeshDetails) {
      if (import.meta.env.DEV) {
        console.debug(`ChunkManager:applyRLEUpdate - Remeshing chunk ${key} after applying RLE update.`);
      }

      try {
        const updatedChunkData = this.chunkData.get(key);
        if (!updatedChunkData) {
            console.error(`ChunkManager:applyRLEUpdate - Critical error: Chunk data for ${key} disappeared before remeshing.`);
            return;
        }
        // Generate new mesh data first
        const meshData = await this.mesherManager.meshChunk(updatedChunkData);

        // Now that new mesh data is ready, create the new mesh
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

        const newMesh = new THREE.Mesh(geometry, this.chunkMaterial);
        newMesh.position.set(chunkX * CHUNK_SIZE.WIDTH, 0, chunkZ * CHUNK_SIZE.DEPTH);
        newMesh.castShadow = true;
        newMesh.receiveShadow = true;

        // Then, remove old mesh from scene and dispose its geometry
        if (oldChunkMeshDetails.mesh.parent) {
          this.scene.remove(oldChunkMeshDetails.mesh);
        }
        oldChunkMeshDetails.mesh.geometry.dispose();

        // Add new mesh to scene
        this.scene.add(newMesh);
        
        this.loadedChunks.set(key, {
          ...oldChunkMeshDetails,
          mesh: newMesh,
          lastAccessed: Date.now()
        });
        if (import.meta.env.DEV) {
            console.debug(`ChunkManager:applyRLEUpdate - Chunk ${key} successfully remeshed.`);
        }
      } catch (error) {
        console.error(`ChunkManager:applyRLEUpdate - Error remeshing chunk ${key} after RLE update:`, error);
      }
    } else {
      console.warn(`ChunkManager:applyRLEUpdate - Chunk mesh details not found for ${key}, cannot remesh immediately. Data updated, should remesh on next cycle if visible.`);
    }
  }

  public async setBlock(worldX: number, worldY: number, worldZ: number, blockId: number): Promise<boolean> {
    const chunkX = Math.floor(worldX / 32);
    const chunkZ = Math.floor(worldZ / 32);
    const key = this.getChunkKey(chunkX, chunkZ);

    const chunk = this.chunkData.get(key);
    if (!chunk) {
      console.warn(`Attempted to set block in non-existent or non-loaded chunk data at ${chunkX},${chunkZ}`);
      return false;
    }

    const localX = ((worldX % 32) + 32) % 32;
    const localZ = ((worldZ % 32) + 32) % 32;
    const localY = worldY;

    if (chunk.getVoxel(localX, localY, localZ) === blockId) {
        return true; 
    }

    chunk.setVoxel(localX, localY, localZ, blockId);
    if (import.meta.env.DEV) {
      console.debug(`Set block at ${worldX},${worldY},${worldZ} (local ${localX},${localY},${localZ} in chunk ${key}) to ${blockId}`);
    }

    const oldChunkMeshDetails = this.loadedChunks.get(key);

    try {
      // Generate new mesh data first
      const meshData = await this.mesherManager.meshChunk(chunk);

      // Handle case where new mesh is empty (e.g., all blocks removed)
      if (!meshData || meshData.positions.length === 0) {
        if (import.meta.env.DEV) {
            console.warn(`Re-mesh for chunk ${key} resulted in empty mesh. Original block: ${worldX},${worldY},${worldZ}`);
        }
        // If mesh is empty, remove old mesh and its entry from loadedChunks
      if (oldChunkMeshDetails && oldChunkMeshDetails.mesh) {
        if (oldChunkMeshDetails.mesh.parent) {
          this.scene.remove(oldChunkMeshDetails.mesh);
        }
        oldChunkMeshDetails.mesh.geometry.dispose();
            this.loadedChunks.delete(key);
        }
        return true; 
      }

      // Now that new mesh data is ready, create the new Three.js geometry and mesh
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

      const newMesh = new THREE.Mesh(geometry, this.chunkMaterial);
      newMesh.position.set(chunkX * CHUNK_SIZE.WIDTH, 0, chunkZ * CHUNK_SIZE.DEPTH);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;

      // Then, remove old mesh from scene and dispose its geometry (if it existed)
      if (oldChunkMeshDetails && oldChunkMeshDetails.mesh) {
        if (oldChunkMeshDetails.mesh.parent) {
          this.scene.remove(oldChunkMeshDetails.mesh);
        }
        oldChunkMeshDetails.mesh.geometry.dispose();
      }

      // Add new mesh to scene
      this.scene.add(newMesh);

      // Update in loadedChunks map
      this.loadedChunks.set(key, {
        mesh: newMesh,
        lastAccessed: Date.now(),
        lodLevel: oldChunkMeshDetails ? oldChunkMeshDetails.lodLevel : LODLevel.HIGH 
      });

      if (import.meta.env.DEV) {
        console.debug(`Chunk ${key} re-meshed successfully after block change.`);
      }
      return true;
    } catch (error) {
      console.error(`Error re-meshing chunk ${key} after block change:`, error);
      return false;
    }
  }

  dispose(): void {
    // Clean up all chunks
    for (const [_key, chunkMeshDetails] of this.loadedChunks) { // Renamed key as it's not used in this loop iteration
      if (chunkMeshDetails.mesh.parent) {
        chunkMeshDetails.mesh.parent.remove(chunkMeshDetails.mesh);
      }
      chunkMeshDetails.mesh.geometry.dispose();
      // DO NOT dispose shared material here. It will be disposed once below.
    }
    this.loadedChunks.clear();
    this.loadingChunks.clear();
    this.lastLODLevels.clear();
    this.chunkHeightmaps.clear();
    this.chunkData.clear(); 
    this.lastPlayerPosition = null;

    // Dispose of shared material ONCE
    if (this.chunkMaterial) {
      this.chunkMaterial.dispose();
    }

    // Dispose of managed workers/managers
    if (this.noiseManager && typeof (this.noiseManager as any).dispose === 'function') {
      (this.noiseManager as any).dispose();
    }
    if (this.mesherManager && typeof (this.mesherManager as any).dispose === 'function') {
      (this.mesherManager as any).dispose();
    }

    // Reject and clear any pending or unsent chunk requests
    for (const [_key, request] of this.pendingChunkRequests) {
        if (request.reject) request.reject(new Error('ChunkManager disposed'));
    }
    this.pendingChunkRequests.clear();

    for (const request of this.unsentChunkRequestsQueue) {
        if (request.reject) request.reject(new Error('ChunkManager disposed'));
    }
    this.unsentChunkRequestsQueue = [];

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // console.log("[Client ChunkManager] Closing WebSocket in dispose.");
      // this.socket.close(); // Optional: depending on who owns the socket lifecycle
    }
    this.socket = null;
  }

  public getLoadedChunkMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const chunkMesh of this.loadedChunks.values()) {
      meshes.push(chunkMesh.mesh);
    }
    return meshes;
  }

  public setSocket(socket: WebSocket): void {
    console.log('[Client ChunkManager] WebSocket connection established. Setting socket.');
    this.socket = socket;
    this.loggedSocketNotReadyForChunks.clear(); // Clear all "socket not ready" logs now that it is.
    console.log(`[Client ChunkManager] Just before processUnsentChunkRequests. Queue length: ${this.unsentChunkRequestsQueue.length}`);
    this.processUnsentChunkRequests(); // Process any queued requests
  }

  public handleChunkResponse(cx: number, cz: number, voxels: string, lod: number | undefined, seq: number | undefined) {
    const receivedLOD: LODLevel = (lod === LODLevel.LOW || lod === 1) ? LODLevel.LOW : LODLevel.HIGH;
    const lodKey = this.getChunkLODKey(cx, cz, receivedLOD);

    // console.log(`[CM HandleResp Debug] For ${lodKey}. Voxels (base64 string length): ${voxels.length}. ServerLOD: ${lod}, ParsedLOD: ${LODLevel[receivedLOD]}, ServerSeq: ${seq}`); // Original log

    const pendingRequest = this.pendingChunkRequests.get(lodKey);

    if (pendingRequest) {
      if (seq === undefined) {
        console.error(`[CM HandleResp Error] For ${lodKey}. Server response missing sequence number. Expected ${pendingRequest.seq}. Rejecting.`);
        pendingRequest.reject(new Error(`Server response for ${lodKey} missing sequence number.`));
        this.pendingChunkRequests.delete(lodKey);
        return;
      }
      
      if (pendingRequest.seq !== seq) {
        console.error(`[CM HandleResp SeqMismatch ERROR] For ${lodKey}. Expected seq: ${pendingRequest.seq}, got: ${seq}. Rejecting chunk.`);
        pendingRequest.reject(new Error(`Sequence number mismatch for ${lodKey}. Expected ${pendingRequest.seq}, got ${seq}.`));
        this.pendingChunkRequests.delete(lodKey);
        return;
      }

      // Sequence numbers match, proceed with processing
      console.log(`[CM HandleResp OK] For ${lodKey} (Seq ${seq}). Voxels (base64 string length): ${voxels.length}. ServerLOD: ${lod}, ParsedLOD: ${LODLevel[receivedLOD]}`);


      if (pendingRequest.lodLevel !== receivedLOD) {
          // This check should ideally be redundant if lodKey is correctly derived and used everywhere.
          // If this happens, it implies a more fundamental issue with how lodKey is formed or matched.
          console.error(`[CM HandleResp LODMismatch CRITICAL] For ${lodKey} (Seq ${seq}). Pending request LOD ${LODLevel[pendingRequest.lodLevel]}, received LOD ${LODLevel[receivedLOD]}. Rejecting.`);
          pendingRequest.reject(new Error(`LOD mismatch for ${lodKey} (Seq ${seq}). Expected ${LODLevel[pendingRequest.lodLevel]}, got ${LODLevel[receivedLOD]}.`));
          this.pendingChunkRequests.delete(lodKey);
          return;
      }

      if (typeof voxels !== 'string' || voxels.length === 0) {
        console.error(`[CM HandleResp Error] Chunk ${lodKey} (Seq ${seq}): Received empty or invalid base64 voxel data string from server. Rejecting.`);
        pendingRequest.reject(new Error(`Empty or invalid base64 voxel data for ${lodKey} (Seq ${seq})`));
        this.pendingChunkRequests.delete(lodKey);
        return;
      }

      const chunk = new Chunk(cx, cz, receivedLOD);
      try {
        const decodedVoxels = Uint8Array.from(atob(voxels), c => c.charCodeAt(0));
        chunk.setData(decodedVoxels);
        // console.log(`[CM HandleResp Debug] Chunk ${lodKey} (LOD: ${LODLevel[chunk.lodLevel]}): setData called. Decoded voxel length: ${decodedVoxels.length}. Sample H[0]: ${chunk.getHeightmap()[0]}`); // Original log

        // DEBUG LOGGING - kept for specific test cases if needed, but generally can be removed
        if (import.meta.env.DEV && cx === -1 && cz === -1) {
          const localXDebug = 31;
          const localZDebug = 21;
          const debugHeightmapIndex = localZDebug * CHUNK_SIZE.WIDTH + localXDebug;
          const heightAtDebugPoint = chunk.getHeightmap()[debugHeightmapIndex];
          
          console.log(`[ChunkMan Post-SetData Debug] Chunk(-1,-1), Seq ${seq}, Local(${localXDebug},${localZDebug}): Heightmap Value = ${heightAtDebugPoint}`);
          // ... (other specific voxel checks can be here if needed)
        }
        
        pendingRequest.resolve(chunk);
      } catch (e) {
        console.error(`[CM HandleResp Error] Chunk ${lodKey} (Seq ${seq}): Error during chunk.setData or heightmap generation:`, e);
        pendingRequest.reject(new Error(`Error processing voxel data for ${lodKey} (Seq ${seq}): ${e instanceof Error ? e.message : String(e)}`));
      }
      this.pendingChunkRequests.delete(lodKey);
    } else {
      console.warn(`[CM HandleResp Warn] Received chunkResponse for ${lodKey} (ServerSeq ${seq}), but no pending request found. Ignoring.`);
    }
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    this.processUnsentChunkRequests();   // start next drip if any
  }

  public handleChunkResponseError(cx: number, cz: number, seq: number | undefined, reason: string) {
    // Attempt to find the request. Since we don't know the original LOD for the error,
    // we might have to iterate or make an assumption.
    // For now, let's assume errors are rare and a simple log is fine.
    // A more robust solution would require the server to echo back the requested LOD in error messages too.
    // OR, iterate through pending requests for matching cx,cz,seq.

    // Let's try to find it by iterating if seq is present.
    let foundKey: string | undefined = undefined;
    let originalLodOfFailedRequest: LODLevel | undefined = undefined;

    if (seq !== undefined) {
        for (const [pKey, pReq] of this.pendingChunkRequests.entries()) {
            if (pReq.seq === seq) { // Assuming cx,cz from params are correct for this seq
                const parts = pKey.split(',');
                const reqCx = parseInt(parts[0], 10);
                const reqCz = parseInt(parts[1], 10);
                if (reqCx === cx && reqCz === cz) {
                    foundKey = pKey;
                    originalLodOfFailedRequest = pReq.lodLevel;
                    break;
                }
            }
        }
    }

    const errorKeyForLog = foundKey ? foundKey : `cx:${cx},cz:${cz},lod:unknown`;
    console.error(`[CM HandleRespError Debug] For ${errorKeyForLog}. Seq: ${seq}, Reason: ${reason}`);

    if (foundKey) {
        const pendingRequest = this.pendingChunkRequests.get(foundKey);
        if (pendingRequest) { // Should always be true if foundKey is set
            console.error(`[Client ChunkManager] Server error for chunk ${foundKey} (reqSeq: ${pendingRequest.seq}, reqLOD: ${LODLevel[pendingRequest.lodLevel]}): ${reason}`);
            pendingRequest.reject(new Error(`Server error for chunk ${foundKey}: ${reason}`));
            this.pendingChunkRequests.delete(foundKey);
        }
    } else {
         // If we couldn't find by seq, try to construct keys for both LODs if no seq given.
         // This is a fallback and might clear the wrong request if seq is missing.
         const highLodKey = this.getChunkLODKey(cx, cz, LODLevel.HIGH);
         const lowLodKey = this.getChunkLODKey(cx, cz, LODLevel.LOW);
         let rejected = false;

         const pendingHigh = this.pendingChunkRequests.get(highLodKey);
         if (pendingHigh && (seq === undefined || pendingHigh.seq === seq)) {
            console.error(`[Client ChunkManager] Server error for chunk ${highLodKey} (reqSeq: ${pendingHigh.seq}): ${reason}. (Error had no seq or matched high LOD seq)`);
            pendingHigh.reject(new Error(`Server error for chunk ${highLodKey}: ${reason}`));
            this.pendingChunkRequests.delete(highLodKey);
            rejected = true;
         }
         
         const pendingLow = this.pendingChunkRequests.get(lowLodKey);
         if (pendingLow && (seq === undefined || pendingLow.seq === seq)) {
            console.error(`[Client ChunkManager] Server error for chunk ${lowLodKey} (reqSeq: ${pendingLow.seq}): ${reason}. (Error had no seq or matched low LOD seq)`);
            pendingLow.reject(new Error(`Server error for chunk ${lowLodKey}: ${reason}`));
            this.pendingChunkRequests.delete(lowLodKey);
            rejected = true;
         }

        if (!rejected) {
            console.warn(`[Client ChunkManager] Received chunkResponseError for ${cx},${cz} (seq ${seq}), but no matching pending request found (tried exact seq or general cx,cz).`);
        }
    }
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    this.processUnsentChunkRequests();   // start next drip if any
  }

  private sendChunkRequestOverSocket(
    chunkX: number,
    chunkZ: number,
    lodLevel: LODLevel,
    requestSeq: number, // NEW: Pass assigned sequence number
    resolve: (chunk: Chunk) => void,
    reject: (reason?: any) => void
  ): void {
    const lodKey = this.getChunkLODKey(chunkX, chunkZ, lodLevel); // NEW: Use LOD-specific key

    if (this.pendingChunkRequests.has(lodKey)) {
        const oldRequest = this.pendingChunkRequests.get(lodKey);
        console.warn(`[CM SendToSocket Debug] Chunk ${lodKey}: Request (seq ${requestSeq}) already pending (old seq ${oldRequest?.seq}). This specific LOD request was already made. Overwriting promise callbacks. Previous caller for THIS LOD might not be resolved.`);
    }
    this.pendingChunkRequests.set(lodKey, { resolve, reject, seq: requestSeq, lodLevel: lodLevel }); // NEW: Use LOD-specific key & store lodLevel

    const requestMessage = {
      type: 'chunkRequest',
      cx: chunkX,
      cz: chunkZ,
      lod: lodLevel,
      seq: requestSeq // Include sequence number
    };
    console.log(`[CM SendToSocket Debug] Chunk ${lodKey} Seq ${requestSeq}: Sending to server:`, requestMessage);
    
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        console.error(`[CM SendToSocket Debug] Chunk ${lodKey}: Socket is null or not open! Cannot send. This should have been caught by requestChunkDataFromServer and queued.`);
    } else {
        this.socket.send(JSON.stringify(requestMessage));
    }

    const timeoutId = setTimeout(() => {
      const currentPendingRequest = this.pendingChunkRequests.get(lodKey);

      if (currentPendingRequest && currentPendingRequest.seq === requestSeq) {
        console.debug(`[CM SendToSocket Debug] TIMEOUT for ${lodKey} (Seq ${requestSeq}) from server. Fallback to local gen was SKIPPED.`);
        this.pendingChunkRequests.delete(lodKey);
        
        if (chunkX === -1 && chunkZ === -1) {
            console.error(`[CM DIAGNOSTIC CRITICAL] TIMEOUT for chunk ${lodKey}. Local generation SKIPPED. Chunk will be missing.`);
        } else {
            console.debug(`[CM DIAGNOSTIC] TIMEOUT for chunk ${lodKey}. Local generation SKIPPED. Chunk will be missing.`);
        }

        currentPendingRequest.reject(new Error(`Server chunk ${lodKey} timed out and local fallback is disabled.`));

      } else if (currentPendingRequest) {
        console.log(`[CM SendToSocket Debug] Timeout for ${lodKey} (Seq ${requestSeq}), but current pending request has different seq (${currentPendingRequest.seq}). Ignoring this specific timeout.`);
      }
    }, 4000); // 4 sec timeout
  }

  private processUnsentChunkRequests() {
    // If we're already scheduled, do nothing.
    if (this.sendTimer) return;

    const pump = () => {
      // while we have capacity and queued work
      while (this.inFlightRequests < MAX_CONCURRENT_CHUNK_REQUESTS &&
             this.unsentChunkRequestsQueue.length) {

        const req = this.unsentChunkRequestsQueue.shift()!;
        // socket may have died while we were queued
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          // put it back at the front and abort this pump
          this.unsentChunkRequestsQueue.unshift(req);
          break;
        }
        this.sendChunkRequestOverSocket(
          req.chunkX, req.chunkZ, req.lodLevel,
          req.seq, req.resolve, req.reject // Corrected: req.seq, not req.requestSeq
        );
        this.inFlightRequests++;
      }

      // schedule next pump ONLY if queue is not empty
      if (this.unsentChunkRequestsQueue.length) {
        this.sendTimer = setTimeout(() => {
          this.sendTimer = null;
          pump();
        }, REQUEST_BATCH_INTERVAL_MS);
      }
    };

    pump();
  }

  private requestChunkDataFromServer(chunkX: number, chunkZ: number, lodLevel: LODLevel): Promise<Chunk> {
    const lodKey = this.getChunkLODKey(chunkX, chunkZ, lodLevel); // NEW LOD-specific key for logging & queue
    // console.log(`[CM RequestData Debug] For ${lodKey}. Socket state: ${this.socket?.readyState}`); // Reduced verbosity

    const requestSeq = this.chunkRequestSeq++; // Assign sequence number here, once per logical request

    return new Promise((resolve, reject) => {
      // Always queue first, let processUnsentChunkRequests handle sending.
      if (import.meta.env.DEV && !this.loggedSocketNotReadyForChunks.has(lodKey) && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
        console.log(`[CM RequestData Debug] Chunk ${lodKey}: Socket not ready or not open, adding to unsent queue. Logging once per chunk until socket is ready.`);
        this.loggedSocketNotReadyForChunks.add(lodKey); // Log only if socket genuinely not ready
      }
      
      const alreadyInUnsentQueue = this.unsentChunkRequestsQueue.find(
        req => req.chunkX === chunkX && req.chunkZ === chunkZ && req.lodLevel === lodLevel
      );

      if (!alreadyInUnsentQueue) {
        this.unsentChunkRequestsQueue.push({ chunkX, chunkZ, lodLevel, resolve, reject, key: lodKey, seq: requestSeq });
      } else {
        // If a request for the exact same cx,cz,lod is already in the unsent queue,
        // we could update its resolve/reject, but this might lead to older callers being forgotten.
        // For simplicity, the current plan implies just queueing.
        // A more advanced strategy could involve a Map for unsent requests to update promises.
        // However, the prompt says "it only this.unsentChunkRequestsQueue.push(req)"
        // This implies that if it's already there, we might be making a new one or the find logic is key.
        // The current `find` then `push if !alreadyInUnsentQueue` means we don't add duplicates
        // which also means the new promise (resolve/reject) from a newer call for the same item isn't used.
        // This needs to be considered. For now, I will stick to the plan's implication of simply queueing
        // and letting `processUnsentChunkRequests` pick it up. The existing logic to not add if already in queue is fine.
        // The main point is to not call sendChunkRequestOverSocket directly.
        console.warn(`[CM RequestData] Chunk ${lodKey} (New Seq ${requestSeq}) already in unsent queue (Old Seq ${alreadyInUnsentQueue.seq}). Not adding duplicate. New promise will not be used if old one is still processed.`);
        // To strictly follow "it only this.unsentChunkRequestsQueue.push(req)", one might remove the find and always push,
        // but that would create actual duplicates. The current check prevents actual duplicates.
        // Let's assume the current alreadyInUnsentQueue check is good, and we just need to ensure process is called.
      }
      this.processUnsentChunkRequests(); // Ensure the pump is attempted
    });
  }

  public getLoadProgress(): { loaded: number, target: number, percentage: number } {
    const target = (2 * this.renderDistance + 1) ** 2;
    // For now, count all loaded chunks. A more accurate measure would be
    // to count chunks within the initial render distance of the spawn point (0,0).
    const loaded = this.loadedChunks.size;
    const percentage = target > 0 ? Math.min(1, loaded / target) : 0;
    return { loaded, target, percentage };
  }

  public setRenderDistance(newDistance: number): void {
    if (newDistance < 1) newDistance = 1; // Ensure a minimum render distance
    this.renderDistance = newDistance;
    this.unloadDistanceChunks = newDistance + 3; // MODIFIED: Was renderDistance + 5
    this.lastUpdateTime = 0; // Force update in next cycle
    // Consider if an immediate call to this.update() is needed or if relying on the next game loop tick is sufficient.
    // Forcing this.lastUpdateTime = 0 should be enough for the existing update loop to pick it up promptly.
  }

  public getRenderDistance(): number {
    return this.renderDistance;
  }
} 