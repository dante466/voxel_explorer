import * as THREE from 'three';
import { Chunk, LODLevel, CHUNK_SIZE } from './Chunk';
import { NoiseManager } from './NoiseManager';
import { MesherManager } from './MesherManager';

interface ChunkMesh {
  mesh: THREE.Mesh;
  lastAccessed: number;
  lodLevel: LODLevel;
}

// Define a type for the callback that will process the received chunk data
type ChunkDataCallback = (chunk: Chunk) => void;

interface UnsentChunkRequest { // Added interface for queued requests
  chunkX: number;
  chunkZ: number;
  lodLevel: LODLevel;
  resolve: (chunk: Chunk) => void;
  reject: (reason?: any) => void;
  key: string;
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
  private updateInterval: number = 200;
  private maxChunksPerFrame: number = 8;
  private batchSize: number = 2;
  private chunkHeightmaps: Map<string, Uint8Array> = new Map();
  private chunkData: Map<string, Chunk> = new Map();
  private loggedMissingHeightmaps: Set<string> = new Set();
  private loggedSocketNotReadyForChunks: Set<string> = new Set();

  // For handling pending chunk requests from the server
  private pendingChunkRequests: Map<string, { resolve: (chunk: Chunk) => void, reject: (reason?: any) => void }> = new Map();
  private unsentChunkRequestsQueue: UnsentChunkRequest[] = []; // Added queue for unsent requests

  constructor(
    noiseManager: NoiseManager,
    mesherManager: MesherManager,
    scene: THREE.Scene,
    socket: WebSocket | null, // Allow null for local fallback or testing
    renderDistance: number = 3,
    maxLoadedChunks: number = 100,
    unloadDistanceChunks?: number
  ) {
    this.noiseManager = noiseManager;
    this.mesherManager = mesherManager;
    this.scene = scene;
    this.socket = socket; // Store the WebSocket instance
    this.renderDistance = renderDistance;
    this.unloadDistanceChunks = unloadDistanceChunks !== undefined ? unloadDistanceChunks : renderDistance + 2;
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

  private getDistanceToChunk(playerX: number, playerZ: number, chunkX: number, chunkZ: number): number {
    const playerChunkX = Math.floor(playerX / 32);
    const playerChunkZ = Math.floor(playerZ / 32);
    const dx = playerChunkX - chunkX;
    const dz = playerChunkZ - chunkZ;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private getLODLevelForDistance(distance: number, chunkKey: string): LODLevel {
    const lastLOD = this.lastLODLevels.get(chunkKey);
    // const baseLOD = distance > this.lodTransitionDistance ? LODLevel.LOW : LODLevel.HIGH; 
    // For now, let's simplify and always request HIGH LOD from server, server can decide if it sends different LODs later
    const baseLOD = LODLevel.HIGH;
    
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
    // if (this.loadedChunks.has(key) || this.loadingChunks.has(key)) return; // Original check
    // Ensure that if a chunk is loaded, its LOD is appropriate, or reload if not.
    const existingChunk = this.loadedChunks.get(key);
    if (existingChunk) {
        if (existingChunk.lodLevel === lodLevel) {
            existingChunk.lastAccessed = Date.now(); // Update access time
            return; // Already loaded with correct LOD
        } else {
            // console.log(`[Client ChunkManager] Chunk ${key} exists with LOD ${existingChunk.lodLevel}, requested ${lodLevel}. Reloading.`);
            // Different LOD requested, unload current and reload.
            await this.unloadChunk(key, scene); 
            // Proceed to load with new LOD below.
        }
    }
    if (this.loadingChunks.has(key)) { // Still loading, perhaps for a different LOD.
        // This logic might need to be more sophisticated if multiple LOD requests for the same chunk can interleave.
        // For now, if it's in loadingChunks, assume the current load process will handle it or be superseded.
        // console.warn(`[Client ChunkManager] Chunk ${key} is already in loadingChunks set. Skipping new load attempt for LOD ${lodLevel}.`);
        return;
    }

    this.loadingChunks.add(key);
    this.lastLODLevels.set(key, lodLevel); // Store the target LOD
    if (import.meta.env.DEV) {
      // console.debug(`Loading chunk at ${chunkX}, ${chunkZ} with LOD ${lodLevel}`);
      console.log(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Attempting to load chunk.`);
    }

    try {
      // Generate chunk data - NOW REQUESTS FROM SERVER OR FALLS BACK
      // const chunk = await this.noiseManager.generateChunk(chunkX, chunkZ, lodLevel); // OLD WAY
      console.log(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Calling requestChunkDataFromServer.`);
      const chunk = await this.requestChunkDataFromServer(chunkX, chunkZ, lodLevel); // NEW WAY
      
      if (!chunk) {
        // console.error(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Failed to obtain valid chunk object from requestChunkDataFromServer. Cannot proceed.`); // Temporarily comment out
        this.loadingChunks.delete(key); // Clean up loading state
        return;
      }
      const chunkVoxelData = chunk.getData(); // Use getData() to access voxel data for logging
      if (!chunkVoxelData || chunkVoxelData.length === 0) {
        // console.error(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Obtained chunk object, but its voxel data is null or empty. Cannot proceed.`); // Temporarily comment out
        this.loadingChunks.delete(key);
        return;
      }

      console.log(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Chunk data obtained. Voxel length: ${chunkVoxelData.length}.`);

      // Store chunk data (might be redundant if requestChunkDataFromServer's resolution path already does this, but good for clarity)
      this.chunkData.set(key, chunk);

      // Store heightmap (Chunk class should have a method to get/generate this from its data)
      const heightmap = chunk.getHeightmap();
      if (!heightmap || heightmap.length !== CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH) {
        // console.warn(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Invalid or missing heightmap after chunk data obtained. Length: ${heightmap?.length}. Expected: ${CHUNK_SIZE.WIDTH * CHUNK_SIZE.DEPTH}. Regenerated heightmap in Chunk.setData should have fixed this.`); // Temporarily comment out
      } else {
        this.chunkHeightmaps.set(key, heightmap);
        this.loggedMissingHeightmaps.delete(key); // Clear log warning flag
        const heightmapSample = Array.from(heightmap.slice(0, 5)); // Smaller sample
        // console.log(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Stored valid heightmap. Sample H[0..4]: ${heightmapSample.join(',')}`); // Temporarily comment out
      }
      

      // Generate mesh
      console.log(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Attempting to mesh chunk.`);
      const meshData = await this.mesherManager.meshChunk(chunk);
      console.log(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Meshing complete. Positions: ${meshData?.positions?.length}, Indices: ${meshData?.indices?.length}`);

      if (!meshData || meshData.positions.length === 0 || meshData.indices.length === 0) {
        // console.warn(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Meshing produced no geometry. Skipping mesh creation.`); // Temporarily comment out
        // this.loadingChunks.delete(key); // Already in finally
        return; 
      }

      // Create Three.js geometry
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

      // Create mesh
      const chunkMesh = new THREE.Mesh(geometry, this.chunkMaterial);
      chunkMesh.position.set(chunkX * 32, 0, chunkZ * 32);
      chunkMesh.castShadow = true;
      chunkMesh.receiveShadow = true;

      // Add to scene
      scene.add(chunkMesh);
      console.log(`[CM LoadChunk Debug] Chunk ${key} LOD ${lodLevel}: Mesh ADDED to scene successfully.`);

      // Store chunk
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
      // console.error(`[CM LoadChunk Debug] Error loading chunk ${key} (LOD ${lodLevel}):`, error); // Temporarily comment out
    } finally {
      this.loadingChunks.delete(key);
    }
  }

  private async unloadChunk(key: string, scene: THREE.Scene): Promise<void> {
    const chunkData = this.loadedChunks.get(key);
    if (chunkData) {
      // Remove from scene first
      if (chunkData.mesh.parent) {
        scene.remove(chunkData.mesh);
      }
      
      // Dispose of geometry and material
      chunkData.mesh.geometry.dispose();
      // Material is shared, so we don't dispose it here unless it becomes unique
      // if (Array.isArray(chunkData.mesh.material)) {
      //   chunkData.mesh.material.forEach(material => material.dispose());
      // } else {
      //   chunkData.mesh.material.dispose();
      // }
      
      // Remove from internal data structures
      this.loadedChunks.delete(key);
      this.lastLODLevels.delete(key);
      this.chunkHeightmaps.delete(key);
      this.chunkData.delete(key);
      if (import.meta.env.DEV) {
        console.debug(`Unloaded chunk ${key}`);
      }
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

    // Update if we've moved more than 1 chunk (32 units)
    if (distanceMoved >= 32) {
      this.lastPlayerPosition = { x: playerX, z: playerZ };
      return true;
    }

    // Also update if we have any chunks that need loading
    const playerChunkX = Math.floor(playerX / 32);
    const playerChunkZ = Math.floor(playerZ / 32);
    
    for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
      for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
        const chunkX = playerChunkX + x;
        const chunkZ = playerChunkZ + z;
        const key = this.getChunkKey(chunkX, chunkZ);
        if (!this.loadedChunks.has(key) && !this.loadingChunks.has(key)) {
          return true;
        }
      }
    }

    return false;
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
        
        if (distance <= this.renderDistance) {
          const lodLevel = this.getLODLevelForDistance(distance, key);
          desiredChunksInRenderDistance.set(key, lodLevel);
          this.lastLODLevels.set(key, lodLevel);

          const priority = this.getChunkPriority(playerX, playerZ, chunkX, chunkZ);
          chunkPriorities.push({ key, priority });
        }
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
        // Ensure we only attempt to load chunks that are desired (within renderDistance)
        if (desiredChunksInRenderDistance.has(key)) {
            // Prevent loading more if we'd exceed maxLoadedChunks, considering current + loading count
            // This check helps prevent over-queueing if generation is slow or maxChunksPerFrame is high
            if ((this.loadedChunks.size + this.loadingChunks.size) >= this.maxLoadedChunks && !this.loadedChunks.has(key)) {
                return Promise.resolve();
            }

            if (!this.loadedChunks.has(key) && !this.loadingChunks.has(key)) {
                const [x, z] = key.split(',').map(Number);
                const lodLevel = desiredChunksInRenderDistance.get(key)!;
                chunksLoadedThisFrame++;
                return this.loadChunk(x, z, scene, lodLevel);
            }
        }
        return Promise.resolve();
      });
      
      loadPromises.push(...batchPromises);
      
      // Reduce delay between batches significantly to improve responsiveness
      if (i + this.batchSize < chunkPriorities.length && batchPromises.some(p => p !== Promise.resolve())) { // Only delay if actual loading was initiated
        await new Promise(resolve => setTimeout(resolve, 10)); // Reduced from 50ms to 10ms
      }
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
    
    console.log(`[CM getHeightAtPos] world(${worldX.toFixed(2)},${worldZ.toFixed(2)}) -> chunk(${chunkX},${chunkZ}) key(${key}) -> local(${localX},${localZ}) -> heightmap val=${height}`);
    
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

  public handleChunkResponse(cx: number, cz: number, voxels: number[] /*, lodLevel: LODLevel - if server sends it */) {
    const key = this.getChunkKey(cx, cz);
    const pendingRequest = this.pendingChunkRequests.get(key);

    console.log(`[CM HandleResp Debug] For ${key}. Voxels received: ${voxels?.length}. PendingReq: ${!!pendingRequest}`);

    if (pendingRequest) {
      if (!voxels || voxels.length === 0) {
        console.error(`[CM HandleResp Debug] Chunk ${key}: Received empty or invalid voxel data from server.`);
        pendingRequest.reject(`Empty or invalid voxel data for ${key}`);
        this.pendingChunkRequests.delete(key);
        return;
      }
      const chunk = new Chunk(cx, cz, LODLevel.HIGH); 
      try {
        chunk.setData(new Uint8Array(voxels)); 
        console.log(`[CM HandleResp Debug] Chunk ${key}: setData called. Heightmap regen by Chunk.ts. Sample H[0]: ${chunk.getHeightmap()[0]}`);

        // DEBUG LOGGING FOR CHUNK -1,-1, localX=31, localZ=21
        if (import.meta.env.DEV && cx === -1 && cz === -1) {
          const localXDebug = 31;
          const localZDebug = 21;
          const debugHeightmapIndex = localZDebug * CHUNK_SIZE.WIDTH + localXDebug;
          const heightAtDebugPoint = chunk.getHeightmap()[debugHeightmapIndex];
          
          console.log(`[ChunkMan Post-SetData Debug] Chunk(-1,-1), Local(${localXDebug},${localZDebug}): Heightmap Value = ${heightAtDebugPoint}`);
          console.log(`  getVoxel(${localXDebug},98,${localZDebug}) = ${chunk.getVoxel(localXDebug,98,localZDebug)}`);
          console.log(`  getVoxel(${localXDebug},99,${localZDebug}) = ${chunk.getVoxel(localXDebug,99,localZDebug)}`);
          console.log(`  getVoxel(${localXDebug},100,${localZDebug}) = ${chunk.getVoxel(localXDebug,100,localZDebug)}`);
          console.log(`  getVoxel(${localXDebug},103,${localZDebug}) = ${chunk.getVoxel(localXDebug,103,localZDebug)}`);
          console.log(`  getVoxel(${localXDebug},104,${localZDebug}) = ${chunk.getVoxel(localXDebug,104,localZDebug)}`);
          console.log(`  getVoxel(${localXDebug},105,${localZDebug}) = ${chunk.getVoxel(localXDebug,105,localZDebug)}`);
        }
        // END DEBUG LOGGING
        
        pendingRequest.resolve(chunk);
      } catch (e) {
        console.error(`[CM HandleResp Debug] Chunk ${key}: Error during chunk.setData or heightmap generation:`, e);
        pendingRequest.reject(`Error processing voxel data for ${key}: ${e}`);
      }
      this.pendingChunkRequests.delete(key);
    } else {
      console.warn(`[CM HandleResp Debug] Received chunkResponse for ${key}, but no pending request found.`);
    }
  }

  public handleChunkResponseError(cx: number, cz: number, reason: string) {
    const key = this.getChunkKey(cx, cz);
    console.error(`[CM HandleRespError Debug] For ${key}. Reason: ${reason}`);
    const pendingRequest = this.pendingChunkRequests.get(key);
    if (pendingRequest) {
        console.error(`[Client ChunkManager] Server error for chunk ${key}: ${reason}`);
        pendingRequest.reject(new Error(`Server error for chunk ${key}: ${reason}`));
        this.pendingChunkRequests.delete(key);
    } else {
        console.warn(`[Client ChunkManager] Received chunkResponseError for ${key}, but no pending request found.`);
    }
  }

  private sendChunkRequestOverSocket(
    key: string,
    chunkX: number,
    chunkZ: number,
    lodLevel: LODLevel,
    resolve: (chunk: Chunk) => void,
    reject: (reason?: any) => void
  ): void {
    // If a request for this key is already in pendingChunkRequests, it means we've already sent a request to the server
    // and are waiting for a response (handleChunkResponse or timeout).
    // The current logic is that the LATEST call's resolve/reject overwrites the ones in pendingChunkRequests.
    // This means the last call to loadChunk for a key will get its promise fulfilled.
    if (this.pendingChunkRequests.has(key)) {
        console.warn(`[CM SendToSocket Debug] Chunk ${key} LOD ${lodLevel}: Request already pending. Overwriting stored promise callbacks. Previous caller might not be resolved.`);
    }
    this.pendingChunkRequests.set(key, { resolve, reject });

    const requestMessage = {
      type: 'chunkRequest',
      cx: chunkX,
      cz: chunkZ,
      lod: lodLevel 
    };
    console.log(`[CM SendToSocket Debug] Chunk ${key} LOD ${lodLevel}: Sending to server:`, requestMessage);
    
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        console.error(`[CM SendToSocket Debug] Chunk ${key} LOD ${lodLevel}: Socket is null or not open! Cannot send. This should have been caught by requestChunkDataFromServer and queued.`);
        // This specific call's promise will be rejected by its timeout logic if not caught earlier.
        // Or, if it was added to pendingChunkRequests, it will wait for a response that will never come from this send.
        // This indicates a logic flaw if we reach here.
        // For now, the timeout below will handle rejecting this specific promise.
        // The entry in pendingChunkRequests will also be cleared by that timeout.
    } else {
        this.socket.send(JSON.stringify(requestMessage));
    }

    const timeoutId = setTimeout(() => {
      const currentPendingRequest = this.pendingChunkRequests.get(key);
      if (currentPendingRequest && currentPendingRequest.resolve === resolve) {
        // Changed from console.warn to console.debug
        console.debug(`[CM SendToSocket Debug] TIMEOUT for ${key} (LOD ${lodLevel}) from server. Fallback to local gen was SKIPPED.`);
        this.pendingChunkRequests.delete(key);
        
        // DIAGNOSTIC: Temporarily disable fallback to local generation
        if (chunkX === -1 && chunkZ === -1) {
            console.error(`[CM DIAGNOSTIC CRITICAL] TIMEOUT for chunk ${key} (LOD ${lodLevel}). Local generation SKIPPED. Chunk will be missing.`);
        } else {
            console.debug(`[CM DIAGNOSTIC] TIMEOUT for chunk ${key} (LOD ${lodLevel}). Local generation SKIPPED. Chunk will be missing.`);
        }

        // Instead of generating, reject the promise or handle as missing chunk
        // For now, simply deleting the request and logging. The original promise will remain pending or timeout on its own.
        currentPendingRequest.reject(new Error(`Server chunk ${key} timed out and local fallback is disabled.`));

      } else if (currentPendingRequest) {
        console.log(`[CM SendToSocket Debug] Timeout for ${key} (LOD ${lodLevel}), but stored promise was for a newer request. Ignoring this timeout.`);
      }
      // If !currentPendingRequest, it was already resolved/rejected.
    }, 5000); // 5 sec timeout
  }

  private processUnsentChunkRequests(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[ChunkManager] processUnsentChunkRequests called, but socket is not ready. Aborting processing for now.');
      return;
    }
    console.log(`[ChunkManager] Processing ${this.unsentChunkRequestsQueue.length} unsent chunk requests.`);
    const requestsToProcess = [...this.unsentChunkRequestsQueue];
    this.unsentChunkRequestsQueue = [];

    for (const req of requestsToProcess) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log(`[Client ChunkManager] Processing queued request for ${req.key}`);
        this.sendChunkRequestOverSocket(req.key, req.chunkX, req.chunkZ, req.lodLevel, req.resolve, req.reject);
      } else {
        console.warn(`[Client ChunkManager] Socket closed while processing queue. Re-queuing request for ${req.key}`);
        this.unsentChunkRequestsQueue.push(req); // Add back to the main queue
      }
    }
  }

  private requestChunkDataFromServer(chunkX: number, chunkZ: number, lodLevel: LODLevel): Promise<Chunk> {
    const key = this.getChunkKey(chunkX, chunkZ);
    console.log(`[CM RequestData Debug] For ${key} LOD ${lodLevel}. Socket state: ${this.socket?.readyState}`);

    return new Promise((resolve, reject) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.loggedSocketNotReadyForChunks.delete(key); // Socket is open, clear potential prior log for this chunk
        console.log(`[CM RequestData Debug] Chunk ${key} LOD ${lodLevel}: Socket open, sending request to server via sendChunkRequestOverSocket.`);
        this.sendChunkRequestOverSocket(key, chunkX, chunkZ, lodLevel, resolve, reject);
      } else {
        // Socket not ready. Check if it's already in the unsent queue to avoid duplicates.
        if (import.meta.env.DEV && !this.loggedSocketNotReadyForChunks.has(key)) {
            console.log(`[CM RequestData Debug] Chunk ${key} LOD ${lodLevel}: Socket not ready, adding to unsent queue. Logging once per chunk until socket is ready.`);
            this.loggedSocketNotReadyForChunks.add(key);
        }
        const alreadyInUnsentQueue = this.unsentChunkRequestsQueue.find(
          req => req.key === key && req.lodLevel === lodLevel
        );
        if (!alreadyInUnsentQueue) {
            this.unsentChunkRequestsQueue.push({ chunkX, chunkZ, lodLevel, resolve, reject, key });
        } else {
            console.warn(`[CM RequestData Debug] Chunk ${key} LOD ${lodLevel}: Socket not ready, AND already in unsent queue. Overwriting queued promise callbacks. Previous caller might not resolve.`);
            // Overwrite the resolve/reject of the existing item in the queue with the current ones.
            // This means the latest request for this chunk (while socket is down) will get its promise fulfilled.
            alreadyInUnsentQueue.resolve = resolve;
            alreadyInUnsentQueue.reject = reject;
        }
      }
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
} 