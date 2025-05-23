import './style.css';
import * as THREE from 'three';
import Stats from 'stats.js';
// import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'; // REMOVED
import { NoiseManager } from './world/NoiseManager';
import { MesherManager } from './world/MesherManager';
import { ChunkManager } from './world/ChunkManager';
import { NetworkManager } from './net/NetworkManager';

// ECS IMPORTS
import { createECSWorld, Transform } from './ecs/world';
import { CameraTarget } from './ecs/components/CameraTarget';
import {
  createCameraSystem,
  type CameraSystemControls,
  FPS_EYE_HEIGHT,
  DEFAULT_ZOOM,
} from './ecs/systems/CameraSystem';
import { CameraMode } from './ecs/types';
import { createInputLookSystem } from './ecs/systems/inputLookSystem';
import { createTransformSystem, addObject3DToEntity, object3DMap } from './ecs/systems/transformSystem';
import { createPlayerMovementSystem, type PlayerMovementSystemControls } from './ecs/systems/PlayerMovementSystem';
import { addEntity, addComponent, hasComponent } from 'bitecs';
import { type System as BitecsSystem, type IWorld } from 'bitecs';
import { Object3DRef } from './ecs/systems/transformSystem';
import { getMouseNDC, getPickingRay, raycastVoxel, getCenterScreenRay } from './utils/raycastVoxel';
import { VoxelHighlighter } from './render/Highlight';

// Initialize debugMode early for other systems
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has('debug');

// Player Model Constants
const PLAYER_HEIGHT = 1.8; // meters
const PLAYER_RADIUS = 0.4; // meters

// Constants for M4.2 & M4.3
const DEFAULT_PLACE_BLOCK_ID = 1; // Example: 1 for a generic solid block
let lastBlockActionTime = 0;
const BLOCK_ACTION_COOLDOWN = 250; // milliseconds
let isOnBlockActionCooldown = false;

// Initialize scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue background

// Initialize ECS World
const world = createECSWorld();

// Initialize Camera System
const initialAspect = window.innerWidth / window.innerHeight;
// Player model mesh is created later, so we'll need to pass it after its creation.
// For now, this call will need to be adjusted or CameraSystem needs to fetch it.
// Let's defer full CameraSystem init or pass a placeholder / update it later.
// Temp: For now, just adjust the call, assuming playerModelMesh is defined before this line
// This ordering will be fixed by moving playerModelMesh creation up.

// Initialize Input Look System (pass debugMode)
const inputLookSystemInstance: BitecsSystem = createInputLookSystem(world, document, debugMode);

// Initialize Transform System
const transformSystem = createTransformSystem(world);

// Create Player Entity (MUST BE BEFORE PlayerMovementSystem initialization)
const playerEntity = addEntity(world);
addComponent(world, Transform, playerEntity);
Transform.position.x[playerEntity] = 0;
Transform.position.y[playerEntity] = 70.0; // Temporary spawn height, gravity will adjust
Transform.position.z[playerEntity] = 10; // Start a bit further back
Transform.rotation.x[playerEntity] = 0;
Transform.rotation.y[playerEntity] = 0;
Transform.rotation.z[playerEntity] = 0;
Transform.rotation.w[playerEntity] = 1; // Identity quaternion
Transform.scale.x[playerEntity] = 1;
Transform.scale.y[playerEntity] = 1;
Transform.scale.z[playerEntity] = 1;

addComponent(world, CameraTarget, playerEntity);
CameraTarget.mode[playerEntity] = CameraMode.FPS; // Default to FPS
CameraTarget.zoom[playerEntity] = DEFAULT_ZOOM;
CameraTarget.pitch[playerEntity] = 0;
CameraTarget.yaw[playerEntity] = 0; // Initial yaw, looking along -Z

// Create Player Model Mesh (MOVED UP before CameraSystem initialization)
const playerGeometry = new THREE.CylinderGeometry(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT, 16);
const playerMaterial = new THREE.MeshBasicMaterial({ color: 0x0077ff }); // Blue color
const playerModelMesh = new THREE.Mesh(playerGeometry, playerMaterial);
playerModelMesh.position.y = PLAYER_HEIGHT / 2; 
scene.add(playerModelMesh);

// Initialize managers (needs to be before CameraSystem if it uses chunkManager)
const noiseManager = new NoiseManager(12345);
const mesherManager = new MesherManager();
const chunkManager = new ChunkManager(noiseManager, mesherManager, scene, 4, 100, 5);

// NOW Initialize Camera System, passing playerModelMesh and chunkManager
const cameraSystemManager = createCameraSystem(world, scene, initialAspect, window, playerModelMesh, chunkManager);
const gameCamera = cameraSystemManager.camera;

// Associate player model with player entity for transformSystem
// Ensure Object3DRef component is added before transformSystem runs if it relies on enterQuery
// addObject3DToEntity handles adding the component and map entry.
if (!hasComponent(world, Object3DRef, playerEntity)) {
    addComponent(world, Object3DRef, playerEntity);
}
Object3DRef.value[playerEntity] = playerEntity; // Or some other unique ID if your system expects it.
                                              // For now, map key is entity, value is Object3D.
object3DMap.set(playerEntity, playerModelMesh);

// Initialize Player Movement System (AFTER playerEntity is created and chunkManager is available)
const movementSystemControls = createPlayerMovementSystem(world, playerEntity, document, chunkManager);
const playerMovementSystem = movementSystemControls.system;

// OLD CAMERA INITIALIZATION - REMOVED
// const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// camera.position.set(0, 100, 0); 
// camera.lookAt(0, 0, 0);

// Initialize renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('tabindex', '-1');
document.body.appendChild(renderer.domElement);

// OLD POINTER LOCK CONTROLS - REMOVED
// const controls = new PointerLockControls(camera, document.body);
// scene.add(controls.getObject());

// Add lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(100, 100, 100);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
scene.add(directionalLight);

// Create debug visualization for collision zones
const collisionMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.5, // Increased opacity for better visibility
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1
});

// Cache for collision meshes
const collisionMeshCache: Map<string, THREE.Mesh> = new Map();

// Track last chunk position for collision visualization
let lastCollisionChunkX = -1;
let lastCollisionChunkZ = -1;

// Debug mode variables
let isFlying = true; // This will be controlled by a new movement system later
const flySpeed = 15.0; // This will be controlled by a new movement system later
let showCollisionBoxes = false;
let showBlockHighlighter = true;
let showCrosshair = true; // New state for crosshair toggle

// Create admin menu
const adminMenu = document.createElement('div');
adminMenu.style.position = 'absolute';
adminMenu.style.top = '10px';
adminMenu.style.left = '10px';
adminMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
adminMenu.style.color = 'white';
adminMenu.style.padding = '10px';
adminMenu.style.borderRadius = '5px';
adminMenu.style.fontFamily = 'Arial, sans-serif';
adminMenu.style.display = 'none';
adminMenu.style.zIndex = '1000';

// Create menu content
const menuContent = document.createElement('div');
menuContent.innerHTML = `
  <h3 style="margin: 0 0 10px 0">Admin Menu</h3>
  <div style="margin-bottom: 5px">
    <label style="display: flex; align-items: center; gap: 5px">
      <input type="checkbox" id="flyingToggle" checked>
      Flying Mode
    </label>
  </div>
  <div style="margin-bottom: 5px">
    <label style="display: flex; align-items: center; gap: 5px">
      <input type="checkbox" id="collisionToggle">
      Show Collision Boxes
    </label>
  </div>
  <div style="margin-bottom: 5px">
    <label style="display: flex; align-items: center; gap: 5px">
      <input type="checkbox" id="highlighterToggle" checked>
      Show Block Highlighter (3D)
    </label>
  </div>
  <div style="margin-bottom: 5px">
    <label style="display: flex; align-items: center; gap: 5px">
      <input type="checkbox" id="crosshairToggle" checked>
      Show Crosshair (2D Dot)
    </label>
  </div>
`;
adminMenu.appendChild(menuContent);
document.body.appendChild(adminMenu);

// M4.1 - Create a crosshair element
const crosshairElement = document.createElement('div');
crosshairElement.style.position = 'fixed'; // Use fixed to ensure it's relative to viewport
crosshairElement.style.left = '50%';
crosshairElement.style.top = '50%';
crosshairElement.style.width = '6px'; // Small dot
crosshairElement.style.height = '6px';
crosshairElement.style.backgroundColor = 'red';
crosshairElement.style.borderRadius = '50%'; // Make it a circle
crosshairElement.style.transform = 'translate(-50%, -50%)'; // Center it precisely
crosshairElement.style.zIndex = '1001'; // Ensure it's above admin menu and game canvas
crosshairElement.style.pointerEvents = 'none'; // Prevent it from interfering with mouse events
crosshairElement.style.display = showCrosshair ? 'block' : 'none'; // Initial visibility based on new state
document.body.appendChild(crosshairElement);

// Add event listeners for toggles
const flyingToggle = document.getElementById('flyingToggle') as HTMLInputElement;
const collisionToggle = document.getElementById('collisionToggle') as HTMLInputElement;
const highlighterToggle = document.getElementById('highlighterToggle') as HTMLInputElement;
const crosshairToggle = document.getElementById('crosshairToggle') as HTMLInputElement; // New toggle element

// Ensure admin UI toggles are in sync with initial states
if (flyingToggle) flyingToggle.checked = movementSystemControls.isFlying();
if (collisionToggle) collisionToggle.checked = showCollisionBoxes;
if (highlighterToggle) highlighterToggle.checked = showBlockHighlighter;
if (crosshairToggle) crosshairToggle.checked = showCrosshair; 

flyingToggle.addEventListener('change', (e) => {
  const isChecked = (e.target as HTMLInputElement).checked;
  if (isChecked !== movementSystemControls.isFlying()) {
    movementSystemControls.toggleFlying(); // Sync with PlayerMovementSystem's state
  }
  // The PlayerMovementSystem's toggleFlyingLocal will update the checkbox state again,
  // so no need to explicitly set it here if called through movementSystemControls.toggleFlying().
});

collisionToggle.addEventListener('change', (e) => {
  showCollisionBoxes = (e.target as HTMLInputElement).checked;
  console.debug(`Collision boxes ${showCollisionBoxes ? 'enabled' : 'disabled'}`);
  if (!showCollisionBoxes) {
    // Hide all cached collision meshes
    collisionMeshCache.forEach(mesh => {
      mesh.visible = false;
    });
    // Optionally, also remove from scene if they are direct children.
    // The `updateCollisionVisualization` logic will handle making them visible again if needed.
    // Keeping existing removal for safety, though visibility should suffice.
    scene.children.forEach(child => {
      if (child.userData.isCollisionVisual) {
        child.visible = false; // Primarily rely on this
        // scene.remove(child); // Avoid removing if we plan to reuse from cache
      }
    });
  } else {
    // Force update collision visualization by resetting last chunk pos
    lastCollisionChunkX = -1;
    lastCollisionChunkZ = -1;
    // And ensure all relevant cached meshes are made visible on next update
    // (updateCollisionVisualization will handle this)
  }
});

highlighterToggle.addEventListener('change', (e) => {
  const isChecked = (e.target as HTMLInputElement).checked;
  showBlockHighlighter = isChecked;
  if (!isChecked) {
    // Explicitly hide the 3D wireframe highlighter immediately when its toggle is unchecked.
    if (voxelHighlighter) { // Ensure voxelHighlighter is initialized
        voxelHighlighter.update(null);
    }
  }
  console.debug(`Block highlighter (3D) ${showBlockHighlighter ? 'enabled' : 'disabled'}`);
});

// Event listener for the new crosshair toggle
crosshairToggle.addEventListener('change', (e) => {
  showCrosshair = (e.target as HTMLInputElement).checked;
  if (crosshairElement) { // Ensure crosshairElement is initialized
    crosshairElement.style.display = showCrosshair ? 'block' : 'none';
  }
  console.debug(`Crosshair (2D Dot) ${showCrosshair ? 'enabled' : 'disabled'}`);
});

// Function to check if a point is in view frustum - uses gameCamera now
function isInViewFrustum(currentCamera: THREE.PerspectiveCamera, point: THREE.Vector3): boolean {
  const frustum = new THREE.Frustum();
  const projScreenMatrix = new THREE.Matrix4();
  projScreenMatrix.multiplyMatrices(currentCamera.projectionMatrix, currentCamera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  return frustum.containsPoint(point);
}

// Helper function to get chunk data (can remain outside or be passed if preferred)
function getChunkDataForCollision(chunkX: number, chunkZ: number) {
  const key = `${chunkX},${chunkZ}`;
  return chunkManager.getChunkData(key); // Assumes chunkManager is accessible in this scope
}

// Helper function to check if a block exists, handling chunk boundaries (can remain outside or be passed)
function hasBlockForCollision(worldX: number, worldY: number, worldZ: number): boolean {
  if (worldY < 0 || worldY >= 128) return false;
  
  const chunkX = Math.floor(worldX / 32);
  const chunkZ = Math.floor(worldZ / 32);
  const localX = ((worldX % 32) + 32) % 32; // Handle negative coordinates
  const localZ = ((worldZ % 32) + 32) % 32;
  
  const chunkData = getChunkDataForCollision(chunkX, chunkZ);
  if (!chunkData) return false;
  
  return chunkData.hasBlock(localX, worldY, localZ);
}

function generateCollisionMeshForChunk(
    targetChunkX: number, 
    targetChunkZ: number, 
    playerWorldX: number, // Current player X for distance culling
    playerWorldZ: number  // Current player Z for distance culling
  ): THREE.Mesh | null {
  
  const chunkData = getChunkDataForCollision(targetChunkX, targetChunkZ);
  if (!chunkData) {
    // console.debug(`No chunk data found for collision mesh generation at ${targetChunkX},${targetChunkZ}`);
    return null;
  }

  const positions: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;
  const offset = 0.05;
  // let visibleBlocksInChunk = 0;

  for (let blockX = 0; blockX < 32; blockX++) {
    for (let blockZ = 0; blockZ < 32; blockZ++) {
      for (let blockY = 0; blockY < 128; blockY++) {
        if (!chunkData.hasBlock(blockX, blockY, blockZ)) continue;

        const worldX = targetChunkX * 32 + blockX;
        const worldY = blockY; // worldY is just blockY in this context
        const worldZ = targetChunkZ * 32 + blockZ;
        
        const hasTop = !hasBlockForCollision(worldX, worldY + 1, worldZ);
        const hasBottom = !hasBlockForCollision(worldX, worldY - 1, worldZ);
        const hasFront = !hasBlockForCollision(worldX, worldY, worldZ + 1);
        const hasBack = !hasBlockForCollision(worldX, worldY, worldZ - 1);
        const hasRight = !hasBlockForCollision(worldX + 1, worldY, worldZ);
        const hasLeft = !hasBlockForCollision(worldX - 1, worldY, worldZ);

        if (!hasTop && !hasBottom && !hasFront && !hasBack && !hasRight && !hasLeft) continue;
        // visibleBlocksInChunk++;

        const x_pos = worldX + 0.5;
        const y_pos = worldY + 0.5;
        const z_pos = worldZ + 0.5;
            
        if (hasTop) {
          positions.push(
            x_pos - 0.5, y_pos + 0.5 + offset, z_pos - 0.5, x_pos + 0.5, y_pos + 0.5 + offset, z_pos - 0.5,
            x_pos + 0.5, y_pos + 0.5 + offset, z_pos + 0.5, x_pos - 0.5, y_pos + 0.5 + offset, z_pos + 0.5
          );
          indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          vertexCount += 4;
        }
        if (hasBottom) {
          positions.push(
            x_pos - 0.5, y_pos - 0.5 - offset, z_pos - 0.5, x_pos + 0.5, y_pos - 0.5 - offset, z_pos - 0.5,
            x_pos + 0.5, y_pos - 0.5 - offset, z_pos + 0.5, x_pos - 0.5, y_pos - 0.5 - offset, z_pos + 0.5
          );
          indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          vertexCount += 4;
        }
        if (hasFront) {
          positions.push(
            x_pos - 0.5, y_pos - 0.5, z_pos + 0.5 + offset, x_pos + 0.5, y_pos - 0.5, z_pos + 0.5 + offset,
            x_pos + 0.5, y_pos + 0.5, z_pos + 0.5 + offset, x_pos - 0.5, y_pos + 0.5, z_pos + 0.5 + offset
          );
          indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          vertexCount += 4;
        }
        if (hasBack) {
          positions.push(
            x_pos - 0.5, y_pos - 0.5, z_pos - 0.5 - offset, x_pos + 0.5, y_pos - 0.5, z_pos - 0.5 - offset,
            x_pos + 0.5, y_pos + 0.5, z_pos - 0.5 - offset, x_pos - 0.5, y_pos + 0.5, z_pos - 0.5 - offset
          );
          indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          vertexCount += 4;
        }
        if (hasRight) {
          positions.push(
            x_pos + 0.5 + offset, y_pos - 0.5, z_pos - 0.5, x_pos + 0.5 + offset, y_pos - 0.5, z_pos + 0.5,
            x_pos + 0.5 + offset, y_pos + 0.5, z_pos + 0.5, x_pos + 0.5 + offset, y_pos + 0.5, z_pos - 0.5
          );
          indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          vertexCount += 4;
        }
        if (hasLeft) {
          positions.push(
            x_pos - 0.5 - offset, y_pos - 0.5, z_pos - 0.5, x_pos - 0.5 - offset, y_pos - 0.5, z_pos + 0.5,
            x_pos - 0.5 - offset, y_pos + 0.5, z_pos + 0.5, x_pos - 0.5 - offset, y_pos + 0.5, z_pos - 0.5
          );
          indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          vertexCount += 4;
        }
      }
    }
  }

  if (positions.length === 0) {
    // console.debug(`No visible collision faces for chunk ${targetChunkX},${targetChunkZ}`);
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  
  const mesh = new THREE.Mesh(geometry, collisionMaterial); // collisionMaterial is global
  mesh.renderOrder = 1; 
  // The mesh is positioned at (0,0,0) because its vertex coordinates are already in world space.
  // Or, if vertices are local to chunk, set mesh.position.set(targetChunkX * 32, 0, targetChunkZ * 32);
  // Current implementation has vertices in world space, so mesh position is (0,0,0).
  
  // console.debug(`Generated collision mesh for chunk ${targetChunkX},${targetChunkZ} with ${visibleBlocksInChunk} visible blocks.`);
  return mesh;
}

// Function to update collision visualization - uses gameCamera now
function updateCollisionVisualization(playerPos: THREE.Vector3, _currentCamera: THREE.PerspectiveCamera) {
  if (!showCollisionBoxes) {
    return;
  }

  const currentPlayerChunkX = Math.floor(playerPos.x / 32);
  const currentPlayerChunkZ = Math.floor(playerPos.z / 32);
  
  const chunkDisplayRadiusChunks = 2; // How many chunks in each direction to initially consider
  const collisionVisualizationWorldRadius = chunkDisplayRadiusChunks * 32; // e.g., 2 * 32 = 64 world units
  const visibleChunkKeys = new Set<string>();

  // Determine which chunk keys should be visible based on a world radius
  for (let xOffset = -chunkDisplayRadiusChunks; xOffset <= chunkDisplayRadiusChunks; xOffset++) {
    for (let zOffset = -chunkDisplayRadiusChunks; zOffset <= chunkDisplayRadiusChunks; zOffset++) {
      const vizChunkX = currentPlayerChunkX + xOffset;
      const vizChunkZ = currentPlayerChunkZ + zOffset;
      
      // Calculate center of this visualization candidate chunk
      const chunkCenterX = vizChunkX * 32 + 16; // 16 is half of chunk size 32
      const chunkCenterZ = vizChunkZ * 32 + 16;

      const dx = playerPos.x - chunkCenterX;
      const dz = playerPos.z - chunkCenterZ;
      const distanceToChunkCenter = Math.sqrt(dx * dx + dz * dz);

      if (distanceToChunkCenter <= collisionVisualizationWorldRadius) {
        visibleChunkKeys.add(`${vizChunkX},${vizChunkZ}`);
      }
    }
  }

  // Make non-visible cached meshes invisible
  collisionMeshCache.forEach((mesh, key) => {
    if (!visibleChunkKeys.has(key)) {
      mesh.visible = false;
    }
  });

  // Process chunks that should be visible
  visibleChunkKeys.forEach(key => {
    let mesh: THREE.Mesh | null | undefined = collisionMeshCache.get(key);
    if (mesh) {
      mesh.visible = true;
      // Ensure it's in the scene (it should be if cached and not manually removed elsewhere)
      if (!mesh.parent) {
        scene.add(mesh);
      }
    } else {
      const [chunkXStr, chunkZStr] = key.split(',');
      const chunkX = parseInt(chunkXStr, 10);
      const chunkZ = parseInt(chunkZStr, 10);
      
      mesh = generateCollisionMeshForChunk(chunkX, chunkZ, playerPos.x, playerPos.z);
      if (mesh) {
        mesh.userData.isCollisionVisual = true;
        mesh.userData.chunkKey = key; // Store the key for later identification
        mesh.visible = true;
        collisionMeshCache.set(key, mesh);
        scene.add(mesh);
      }
    }
  });
  // console.debug(`Collision visualization updated. Cache size: ${collisionMeshCache.size}`);
}

// Minimal onKeyDown & onKeyUp in main.tsx, primarily for non-movement debug keys like Admin Menu
const mainKeyDownHandler = (event: KeyboardEvent) => {
  // PlayerMovementSystem handles W,A,S,D,Space,Shift,F,Arrows and calls preventDefault for them.
  // This handler is for other global keys.
  switch (event.code) {
    case 'KeyP':
      event.preventDefault(); // Prevent if 'P' has browser default action while gaming
      adminMenu.style.display = adminMenu.style.display === 'none' ? 'block' : 'none';
      break;
    case 'KeyC':
      event.preventDefault(); // Prevent if 'C' has browser default action
      if (CameraTarget.mode[playerEntity] === CameraMode.FPS) {
        CameraTarget.mode[playerEntity] = CameraMode.TPS;
        // When switching to TPS, you might want to ensure a reasonable default zoom
        // if CameraTarget.zoom hasn't been set by the wheel yet or is 0.
        if (CameraTarget.zoom[playerEntity] === 0) { // Or some other uninitialized check
            CameraTarget.zoom[playerEntity] = DEFAULT_ZOOM; // DEFAULT_ZOOM is from CameraSystem
        }
        console.log('Switched to TPS Camera Mode');
      } else {
        CameraTarget.mode[playerEntity] = CameraMode.FPS;
        console.log('Switched to FPS Camera Mode');
      }
      // Reset pitch on mode switch to avoid disorientation from previous mode's pitch
      CameraTarget.pitch[playerEntity] = 0;
      break;
    // Add other global, non-movement key handlers here if necessary
  }
};

const mainKeyUpHandler = (event: KeyboardEvent) => {
  // PlayerMovementSystem handles keyup for movement keys if it needs to.
  // Add other global, non-movement keyup handlers here if necessary.
};

// Remove old global listeners that were broadly handling movement keys.
// These specific removeEventListener calls are targeting the old, now undefined, onKeyDown/onKeyUp handlers.
// They should be removed as PlayerMovementSystem handles its own listeners,
// and main.tsx now uses mainKeyDownHandler/mainKeyUpHandler for its minimal needs.
// document.removeEventListener('keydown', onKeyDown); // DELETE THIS LINE
// document.removeEventListener('keyup', onKeyUp);   // DELETE THIS LINE

// Add the new minimal listeners for main.tsx (e.g., for admin panel toggle)
if (typeof mainKeyDownHandler !== 'undefined') document.addEventListener('keydown', mainKeyDownHandler);
if (typeof mainKeyUpHandler !== 'undefined') document.addEventListener('keyup', mainKeyUpHandler);

// Track last camera position and direction - OLD
// let lastCameraPosition = new THREE.Vector3();
// let lastCameraDirection = new THREE.Vector3();
// camera.getWorldDirection(lastCameraDirection); // OLD
// lastCameraPosition.copy(camera.position); // OLD

// Click on canvas to request pointer lock
renderer.domElement.addEventListener('click', () => {
  console.log('renderer.domElement click listener fired. Current pointerLockElement:', document.pointerLockElement, 'isPointerLockedToCanvas flag:', isPointerLockedToCanvas);
  if (!isPointerLockedToCanvas && !document.pointerLockElement) { // Check our flag too
    console.log('Attempting to requestPointerLock as flag is false and no element is locked...');
    renderer.domElement.requestPointerLock();
  } else if (isPointerLockedToCanvas) {
    console.log('renderer.domElement click: Ignored, isPointerLockedToCanvas is true.');
  } else if (document.pointerLockElement) {
    console.log('renderer.domElement click: Ignored, another element has pointer lock:', document.pointerLockElement);
  }
});

let isPointerLockedToCanvas = false; // Flag to track pointer lock state on our canvas

const onPointerLockChange = () => { // NAMED FUNCTION
  console.log('onPointerLockChange fired. document.pointerLockElement is:', document.pointerLockElement, 'renderer.domElement is:', renderer.domElement); 
  if (document.pointerLockElement === renderer.domElement || document.pointerLockElement === document.body) { // Accept body as a valid lock target
    console.log('Pointer considered locked for gameplay (target: ' + document.pointerLockElement?.nodeName + ').');
    isPointerLockedToCanvas = true;
  } else {
    console.log('Pointer unlocked from canvas (or locked to a different element).'); 
    isPointerLockedToCanvas = false;
  }
};

const onPointerLockError = () => { // NAMED FUNCTION
  console.error('Pointer lock error.');
  isPointerLockedToCanvas = false; // Ensure flag is false on error
};

document.addEventListener('pointerlockchange', onPointerLockChange, false);
document.addEventListener('pointerlockerror', onPointerLockError, false);

// Initialize stats if in debug mode
let stats: Stats | null = null;
if (debugMode) {
  stats = new Stats();
  stats.showPanel(0);
  document.body.appendChild(stats.dom);
}

// Initialize network manager
const networkManager = new NetworkManager(
  'ws://localhost:3000', // Changed port to 3000 to match server
  world, 
  playerEntity, 
  movementSystemControls, // Pass PlayerMovementSystemControls
  chunkManager // Pass ChunkManager
);
networkManager.connect();

// Handle window resize - NEW CAMERA SYSTEM HANDLES ITS OWN RESIZE
// window.addEventListener('resize', () => {
//   camera.aspect = window.innerWidth / window.innerHeight; // OLD
//   camera.updateProjectionMatrix(); // OLD
//   renderer.setSize(window.innerWidth, window.innerHeight);
// });

// M4.1: Initialize Voxel Highlighter
const voxelHighlighter = new VoxelHighlighter(scene);
const MAX_RAYCAST_DISTANCE = 100; // Max distance for voxel picking

// M4.1 - Function to update center-screen voxel highlight (called in animate loop)
function updateCenterScreenVoxelHighlight() {
  if (!gameCamera || !chunkManager || !voxelHighlighter) return;

  if (!showBlockHighlighter) { 
    voxelHighlighter.update(null);
    return;
  }
  
  const pickRay = getCenterScreenRay(gameCamera);
  const result = raycastVoxel(pickRay.origin, pickRay.direction, chunkManager, MAX_RAYCAST_DISTANCE);
  
  if (result) {
    voxelHighlighter.update(result.position);
  } else {
    voxelHighlighter.update(null);
  }
}

// Event listener for mouse clicks to place/break blocks (M4.2 & M4.3)
function handleBlockInteraction(event: MouseEvent) {
  console.log(
    'handleBlockInteraction called (document mousedown):', event.button, 
    'isPointerLockedToCanvas flag?:', isPointerLockedToCanvas
  );
  if (!isPointerLockedToCanvas) { // Check our flag, not document.pointerLockElement directly here
    // console.log('handleBlockInteraction: Pointer not locked to game canvas (based on flag), returning early.');
    return; 
  }

  const now = Date.now();
  // Cooldown logic primarily for non-flying mode, server will also validate
  if (isOnBlockActionCooldown && !movementSystemControls.isFlying()) {
    // Update crosshair to grey during cooldown
    if (showCrosshair) crosshairElement.style.backgroundColor = 'grey';
    return;
  }

  // Use center screen ray for block interaction
  const centerRay = getCenterScreenRay(gameCamera);
  const hit = raycastVoxel(
    centerRay.origin, 
    centerRay.direction, 
    chunkManager,
    10 // Max distance
  );

  if (hit && hit.voxel && hit.normal) {
    if (event.button === 0) { // Left click - Mine block
      console.log(`Attempting to send mine command for block at: ${hit.voxel.x}, ${hit.voxel.y}, ${hit.voxel.z}`);
      networkManager.sendMineCommand(hit.voxel.x, hit.voxel.y, hit.voxel.z);
    } else if (event.button === 2) { // Right click - Place block
      const placePosition = new THREE.Vector3(
        hit.voxel.x + hit.normal.x,
        hit.voxel.y + hit.normal.y,
        hit.voxel.z + hit.normal.z
      );
      console.log(`Attempting to send place command for block at: ${placePosition.x}, ${placePosition.y}, ${placePosition.z} with block ID ${DEFAULT_PLACE_BLOCK_ID}`);
      networkManager.sendPlaceCommand(placePosition.x, placePosition.y, placePosition.z, DEFAULT_PLACE_BLOCK_ID);
    }
  } else {
    // console.log('No block hit or invalid hit normal.');
  }
}

// ADD new mousedown listener on document for block interaction when pointer is locked to the canvas
const documentMousedownHandler = (event: MouseEvent) => {
  // This handler is always active, handleBlockInteraction will check the lock state flag
  handleBlockInteraction(event);
};

document.addEventListener('mousedown', documentMousedownHandler);

// Animation loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  stats?.begin();
  
  const delta = clock.getDelta();

  // --- ECS SYSTEM CALLS ---
  inputLookSystemInstance(world);
  playerMovementSystem(world, delta);
  cameraSystemManager.system(world);
  transformSystem(world);

  // Update ChunkManager with player's ECS position
  const playerWorldX = Transform.position.x[playerEntity];
  const playerWorldZ = Transform.position.z[playerEntity];
  chunkManager.update(playerWorldX, playerWorldZ, scene, true);

  updateCenterScreenVoxelHighlight();

  // Update crosshair color based on cooldown state (only relevant if cooldown was applied)
  if (isOnBlockActionCooldown && (Date.now() - lastBlockActionTime >= BLOCK_ACTION_COOLDOWN)) {
    isOnBlockActionCooldown = false;
    if (crosshairElement) {
      crosshairElement.style.backgroundColor = 'red'; // Normal color
    }
  }

  // Update collision visualization (if shown)
  if (showCollisionBoxes) {
    const playerPosVec3 = new THREE.Vector3(playerWorldX, Transform.position.y[playerEntity], playerWorldZ);
    updateCollisionVisualization(playerPosVec3, gameCamera);
  }
    
  renderer.render(scene, gameCamera);
  stats?.end();
}

// Start animation loop
// ... existing code ...
animate();

// Cleanup on page unload
window.addEventListener('unload', () => {
  networkManager.disconnect();
  chunkManager.dispose();
  noiseManager.dispose();
  mesherManager.dispose();
  document.removeEventListener('keydown', mainKeyDownHandler);
  document.removeEventListener('keyup', mainKeyUpHandler);
  if (adminMenu.parentNode) document.body.removeChild(adminMenu);

  cameraSystemManager.cleanup();
  if ((inputLookSystemInstance as any).cleanup) {
    (inputLookSystemInstance as any).cleanup();
  }
  movementSystemControls.cleanup();

  collisionMeshCache.forEach(mesh => {
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.parent) mesh.parent.remove(mesh);
  });
  collisionMeshCache.clear();

  if (crosshairElement && crosshairElement.parentNode) {
    crosshairElement.parentNode.removeChild(crosshairElement);
  }

  document.removeEventListener('mousedown', documentMousedownHandler);
  document.removeEventListener('pointerlockchange', onPointerLockChange, false);
  document.removeEventListener('pointerlockerror', onPointerLockError, false);
}); 