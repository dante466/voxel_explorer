import * as THREE from 'three';
import { Chunk, LODLevel } from './Chunk';
import { NoiseManager } from './NoiseManager';
import { MesherManager } from './MesherManager';

interface ChunkMesh {
  mesh: THREE.Mesh;
  lastAccessed: number;
  lodLevel: LODLevel;
}

export class ChunkManager {
  private noiseManager: NoiseManager;
  private mesherManager: MesherManager;
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
  private scene: THREE.Scene;

  constructor(
    noiseManager: NoiseManager,
    mesherManager: MesherManager,
    scene: THREE.Scene,
    renderDistance: number = 3,
    maxLoadedChunks: number = 100,
    unloadDistanceChunks?: number
  ) {
    this.noiseManager = noiseManager;
    this.mesherManager = mesherManager;
    this.scene = scene;
    this.renderDistance = renderDistance;
    this.unloadDistanceChunks = unloadDistanceChunks !== undefined ? unloadDistanceChunks : renderDistance + 2;
    this.maxLoadedChunks = maxLoadedChunks;

    // Create shared material for all chunks
    this.chunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x7CFC00, // Lawn green
      side: THREE.DoubleSide,
      flatShading: true,
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
    const baseLOD = distance > this.lodTransitionDistance ? LODLevel.LOW : LODLevel.HIGH;
    
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
    if (this.loadedChunks.has(key) || this.loadingChunks.has(key)) return;

    this.loadingChunks.add(key);
    if (import.meta.env.DEV) {
      console.debug(`Loading chunk at ${chunkX}, ${chunkZ} with LOD ${lodLevel}`);
    }

    try {
      // Generate chunk data
      const chunk = await this.noiseManager.generateChunk(chunkX, chunkZ, lodLevel);
      if (import.meta.env.DEV) {
        console.debug('Chunk generated:', chunk);
      }

      // Store chunk data
      this.chunkData.set(key, chunk);

      // Store heightmap
      const heightmap = chunk.getHeightmap();
      if (!heightmap || heightmap.length !== 1024) {
        console.error(`Invalid heightmap for chunk ${key}`);
        return;
      }
      this.chunkHeightmaps.set(key, heightmap);

      // Generate mesh
      const meshData = await this.mesherManager.meshChunk(chunk);
      if (import.meta.env.DEV) {
        console.debug('Mesh generated:', meshData);
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

      // Store chunk
      this.loadedChunks.set(key, {
        mesh: chunkMesh,
        lastAccessed: Date.now(),
        lodLevel
      });

      if (import.meta.env.DEV) {
        console.debug(`Chunk loaded at ${chunkX}, ${chunkZ} with LOD ${lodLevel}`);
      }
    } catch (error) {
      console.error(`Error loading chunk at ${chunkX}, ${chunkZ}:`, error);
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
      if (Array.isArray(chunkData.mesh.material)) {
        chunkData.mesh.material.forEach(material => material.dispose());
      } else {
        chunkData.mesh.material.dispose();
      }
      
      // Remove from internal data structures
      this.loadedChunks.delete(key);
      this.lastLODLevels.delete(key);
      this.chunkHeightmaps.delete(key);
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
      if (import.meta.env.DEV) {
        console.debug(`No heightmap found for chunk ${key} at position (${worldX}, ${worldZ})`);
      }
      // Request chunk generation if not loaded
      this.loadChunk(chunkX, chunkZ, this.scene, LODLevel.HIGH).catch(console.error);
      return 64; // Default to sea level if chunk not loaded
    }

    // Ensure coordinates are within bounds
    const localX = Math.max(0, Math.min(31, Math.floor(worldX % 32)));
    const localZ = Math.max(0, Math.min(31, Math.floor(worldZ % 32)));
    const height = heightmap[localX * 32 + localZ];
    
    if (import.meta.env.DEV) {
      console.debug(`Height at (${worldX}, ${worldZ}): ${height} (chunk ${key}, local ${localX},${localZ})`);
    }
    
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

  // M4.2: New method to set a block and update the chunk mesh
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
    const currentLodLevel = oldChunkMeshDetails ? oldChunkMeshDetails.lodLevel : LODLevel.HIGH;

    // Do not remove the old mesh from the scene yet.

    try {
      // 1. Generate new mesh data (this is the async part)
      const meshData = await this.mesherManager.meshChunk(chunk);

      // --- From this point on, we have the new mesh data --- 

      // 2. Now, remove old mesh from scene and dispose its geometry (if it existed)
      if (oldChunkMeshDetails && oldChunkMeshDetails.mesh) {
        if (oldChunkMeshDetails.mesh.parent) {
          this.scene.remove(oldChunkMeshDetails.mesh);
        }
        oldChunkMeshDetails.mesh.geometry.dispose();
      }

      // Handle case where new mesh is empty (e.g., all blocks removed)
      if (!meshData || meshData.positions.length === 0) {
        console.warn(`Re-mesh for chunk ${key} resulted in empty mesh. Original block: ${worldX},${worldY},${worldZ}`);
        // If mesh is empty, ensure it's removed from loadedChunks if it was there, and no new mesh is added.
        if (this.loadedChunks.has(key)) {
            this.loadedChunks.delete(key);
        }
        return true; // Voxel was set, even if mesh is now empty
      }

      // 3. Create new Three.js geometry and mesh
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

      const newChunkMesh = new THREE.Mesh(geometry, this.chunkMaterial);
      newChunkMesh.position.set(chunkX * 32, 0, chunkZ * 32);
      newChunkMesh.castShadow = true;
      newChunkMesh.receiveShadow = true;

      // 4. Add new mesh to scene
      this.scene.add(newChunkMesh);

      // 5. Update in loadedChunks map
      this.loadedChunks.set(key, {
        mesh: newChunkMesh,
        lastAccessed: Date.now(),
        lodLevel: currentLodLevel 
      });

      if (import.meta.env.DEV) {
        console.debug(`Chunk ${key} re-meshed successfully after block change.`);
      }
      return true;
    } catch (error) {
      console.error(`Error re-meshing chunk ${key} after block change:`, error);
      // If an error occurs during re-meshing, the old mesh might still be in the scene (if it wasn't removed yet) 
      // or was removed just before this catch. This part is tricky.
      // If we didn't remove the oldMesh yet, it's still there. If we did, it's gone.
      // The current refined logic removes oldMesh *after* meshData is available but *before* this catch block if an error occurs in geometry creation.
      // So, if an error happens here, the old mesh (if it existed) has already been removed and its geometry disposed.
      // We should ensure that if the new mesh creation fails, the chunk entry is cleaned from loadedChunks.
      if (this.loadedChunks.has(key)){
          const entry = this.loadedChunks.get(key);
          // If the entry still points to the old mesh details that we intended to replace, clean it.
          if(entry === oldChunkMeshDetails){
             this.loadedChunks.delete(key);
          }
      }
      return false;
    }
  }

  dispose(): void {
    // Clean up all chunks
    for (const [key, chunkData] of this.loadedChunks) {
      if (chunkData.mesh.parent) {
        chunkData.mesh.parent.remove(chunkData.mesh);
      }
      chunkData.mesh.geometry.dispose();
      if (Array.isArray(chunkData.mesh.material)) {
        chunkData.mesh.material.forEach(material => material.dispose());
      } else {
        chunkData.mesh.material.dispose();
      }
    }
    this.loadedChunks.clear();
    this.loadingChunks.clear();
    this.lastLODLevels.clear();
    this.chunkHeightmaps.clear();
    this.chunkData.clear();
    this.lastPlayerPosition = null;
  }

  public getLoadedChunkMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const chunkMesh of this.loadedChunks.values()) {
      meshes.push(chunkMesh.mesh);
    }
    return meshes;
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
} 