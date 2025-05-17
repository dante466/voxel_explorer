// --- DOMContentLoaded listener for loading screen MOVED TO TOP ---
document.addEventListener('DOMContentLoaded', () => {
  // This listener primarily ensures the div exists. Hiding is done in main().
  const loadingOverlay = document.getElementById('loading-overlay');
  if (!loadingOverlay) {
    console.error('[Main] Loading overlay element not found!');
  }
  // Initial state of body class might be handled by CSS or here if needed.
  // document.body.classList.add('loading-active'); 
});
// --- END OF MOVED DOMContentLoaded ---

import './style.css';
import * as THREE from 'three';
import Stats from 'stats.js';
import { NoiseManager } from './world/NoiseManager';
import { MesherManager } from './world/MesherManager';
import { ChunkManager } from './world/ChunkManager';
import { NetworkManager } from './net/NetworkManager';
import { createECSWorld, Transform } from './ecs/world';
import { CameraTarget } from './ecs/components/CameraTarget';
import {
  createCameraSystem,
  // type CameraSystemControls, // Not directly used in main.tsx
  // FPS_EYE_HEIGHT, // Not directly used in main.tsx
  DEFAULT_ZOOM,
} from './ecs/systems/CameraSystem';
import { CameraMode } from './ecs/types';
import { createInputLookSystem } from './ecs/systems/inputLookSystem';
import { createTransformSystem, addObject3DToEntity, object3DMap } from './ecs/systems/transformSystem';
import { createPlayerMovementSystem, type PlayerMovementSystemControls } from './ecs/systems/PlayerMovementSystem';
import { addEntity, addComponent, hasComponent, type System as BitecsSystem, type IWorld } from 'bitecs';
import { Object3DRef } from './ecs/systems/transformSystem';
import { getPickingRay, raycastVoxel, getCenterScreenRay } from './utils/raycastVoxel'; // getMouseNDC removed as not used
import { VoxelHighlighter } from './render/Highlight';

// --- ALL APPLICATION LOGIC NOW WRAPPED IN main() ---
async function main() {
  const loadingOverlay = document.getElementById('loading-overlay'); // Get it again inside main

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
  let isOnBlockActionCooldown = false; // This state might be better managed within a system or InputHandler

// Initialize scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue background

// Initialize ECS World
  const world: IWorld = createECSWorld(); // Explicitly type world

// Initialize Camera System
const initialAspect = window.innerWidth / window.innerHeight;

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

  // Create Player Model Mesh
const playerGeometry = new THREE.CylinderGeometry(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT, 16);
  const playerMaterial = new THREE.MeshBasicMaterial({ color: 0x0077ff, wireframe: debugMode }); // Blue color, wireframe in debug
const playerModelMesh = new THREE.Mesh(playerGeometry, playerMaterial);
playerModelMesh.position.y = PLAYER_HEIGHT / 2; 
scene.add(playerModelMesh);

  // Initialize managers
const noiseManager = new NoiseManager(12345);
const mesherManager = new MesherManager();
const chunkManager = new ChunkManager(noiseManager, mesherManager, scene, null, 4, 100, 5);

  // Manually trigger an initial chunk load
  const initialPlayerX = Transform.position.x[playerEntity];
  const initialPlayerZ = Transform.position.z[playerEntity];
  console.log(`[Main] Triggering initial ChunkManager update at ${initialPlayerX.toFixed(2)}, ${initialPlayerZ.toFixed(2)}`);
  chunkManager.update(initialPlayerX, initialPlayerZ, scene, true)
    .then(() => console.log('[Main] Initial ChunkManager update promise resolved.'))
    .catch(error => console.error('[Main] Initial ChunkManager update promise rejected:', error));

  // Initialize Camera System
const cameraSystemManager = createCameraSystem(world, scene, initialAspect, window, playerModelMesh, chunkManager);
const gameCamera = cameraSystemManager.camera;

  // --- CAMERA FAIL-SAFE ---
  if (gameCamera.position.lengthSq() < 0.01) { // Using lengthSq for robustness (avoids sqrt)
    console.warn('[Main/Camera] Fallback position applied due to camera at origin.');
    gameCamera.position.set(0, 80, 20); // Adjusted Y and Z for a potentially better initial view
    gameCamera.lookAt(0, 0, 0);
  }
  // --- END CAMERA FAIL-SAFE ---

if (!hasComponent(world, Object3DRef, playerEntity)) {
    addComponent(world, Object3DRef, playerEntity);
}
  Object3DRef.value[playerEntity] = playerEntity;
object3DMap.set(playerEntity, playerModelMesh);

  // Initialize Player Movement System
  const movementSystemControls: PlayerMovementSystemControls = createPlayerMovementSystem(world, playerEntity, document, chunkManager);
const playerMovementSystem = movementSystemControls.system;

// Initialize renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('tabindex', '-1');
document.body.appendChild(renderer.domElement);

  // --- LIGHTS INITIALIZATION (Ensured inside main) ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(100, 100, 100);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 500; // Default far plane
  // Configure shadow camera bounds appropriately for your scene size
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
scene.add(directionalLight);
  // --- END LIGHTS INITIALIZATION ---

  const voxelHighlighter = new VoxelHighlighter(scene);

  // Debug visualization for collision zones (if needed, keep or remove)
  const collisionMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const collisionMeshCache: Map<string, THREE.Mesh> = new Map();
let lastCollisionChunkX = -1;
let lastCollisionChunkZ = -1;
let showCollisionBoxes = false;
let showBlockHighlighter = true;
  let showCrosshair = true;

  // Admin menu and crosshair
const adminMenu = document.createElement('div');
  adminMenu.style.cssText = 'position:absolute; top:10px; left:10px; background-color:rgba(0,0,0,0.7); color:white; padding:10px; border-radius:5px; font-family:Arial,sans-serif; display:none; z-index:1000;';
const menuContent = document.createElement('div');
menuContent.innerHTML = `
    <h3 style="margin:0 0 10px 0">Admin Menu</h3>
    <div><label><input type="checkbox" id="flyingToggle" checked> Flying</label></div>
    <div><label><input type="checkbox" id="collisionToggle"> Collisions</label></div>
    <div><label><input type="checkbox" id="highlighterToggle" checked> Highlighter</label></div>
    <div><label><input type="checkbox" id="crosshairToggle" checked> Crosshair</label></div>
`;
adminMenu.appendChild(menuContent);
document.body.appendChild(adminMenu);

const crosshairElement = document.createElement('div');
  crosshairElement.style.cssText = 'position:fixed; left:50%; top:50%; width:6px; height:6px; background-color:red; border-radius:50%; transform:translate(-50%,-50%); z-index:1001; pointer-events:none;';
  crosshairElement.style.display = showCrosshair ? 'block' : 'none';
document.body.appendChild(crosshairElement);

const flyingToggle = document.getElementById('flyingToggle') as HTMLInputElement;
const collisionToggle = document.getElementById('collisionToggle') as HTMLInputElement;
const highlighterToggle = document.getElementById('highlighterToggle') as HTMLInputElement;
  const crosshairToggle = document.getElementById('crosshairToggle') as HTMLInputElement;

if (flyingToggle) flyingToggle.checked = movementSystemControls.isFlying();
if (collisionToggle) collisionToggle.checked = showCollisionBoxes;
if (highlighterToggle) highlighterToggle.checked = showBlockHighlighter;
if (crosshairToggle) crosshairToggle.checked = showCrosshair; 

  flyingToggle.addEventListener('change', (e) => { movementSystemControls.toggleFlying(); flyingToggle.checked = movementSystemControls.isFlying(); });
  collisionToggle.addEventListener('change', (e) => { showCollisionBoxes = (e.target as HTMLInputElement).checked; /* ... effects ... */ });
  highlighterToggle.addEventListener('change', (e) => { showBlockHighlighter = (e.target as HTMLInputElement).checked; if (!showBlockHighlighter && voxelHighlighter) voxelHighlighter.update(null); });
  crosshairToggle.addEventListener('change', (e) => { showCrosshair = (e.target as HTMLInputElement).checked; if (crosshairElement) crosshairElement.style.display = showCrosshair ? 'block' : 'none'; });

  function getChunkDataForCollision(chunkX: number, chunkZ: number) { return chunkManager.getChunkData(`${chunkX},${chunkZ}`); }
  function hasBlockForCollision(worldX: number, worldY: number, worldZ: number): boolean { /* ... (implementation as before) ... */ return false;} // Shortened for brevity
  function generateCollisionMeshForChunk( targetChunkX: number, targetChunkZ: number, playerWorldX: number, playerWorldZ: number ): THREE.Mesh | null { /* ... */ return null; } // Shortened
  function updateCollisionVisualization(playerPos: THREE.Vector3, _currentCamera: THREE.PerspectiveCamera) { /* ... (implementation as before) ... */ } // Shortened

const mainKeyDownHandler = (event: KeyboardEvent) => {
  switch (event.code) {
      case 'KeyP': event.preventDefault(); adminMenu.style.display = adminMenu.style.display === 'none' ? 'block' : 'none'; break;
    case 'KeyC':
        event.preventDefault();
        CameraTarget.mode[playerEntity] = CameraTarget.mode[playerEntity] === CameraMode.FPS ? CameraMode.TPS : CameraMode.FPS;
        if (CameraTarget.mode[playerEntity] === CameraMode.TPS && CameraTarget.zoom[playerEntity] === 0) CameraTarget.zoom[playerEntity] = DEFAULT_ZOOM;
      CameraTarget.pitch[playerEntity] = 0;
        console.log(`Switched to ${CameraTarget.mode[playerEntity] === CameraMode.FPS ? 'FPS' : 'TPS'} Camera Mode`);
      break;
    }
  };
  document.addEventListener('keydown', mainKeyDownHandler);
  // Removed mainKeyUpHandler as it was empty

renderer.domElement.addEventListener('click', () => {
    if (!isPointerLockedToCanvas && !document.pointerLockElement) renderer.domElement.requestPointerLock();
  });

  let isPointerLockedToCanvas = false;
  const onPointerLockChange = () => {
    isPointerLockedToCanvas = (document.pointerLockElement === renderer.domElement || document.pointerLockElement === document.body);
    console.log(`Pointer lock active: ${isPointerLockedToCanvas} (Target: ${document.pointerLockElement?.nodeName})`);
  };
  const onPointerLockError = () => { isPointerLockedToCanvas = false; console.error('Pointer lock error.'); };
document.addEventListener('pointerlockchange', onPointerLockChange, false);
document.addEventListener('pointerlockerror', onPointerLockError, false);

let stats: Stats | null = null;
if (debugMode) {
    stats = new Stats(); stats.showPanel(0); document.body.appendChild(stats.dom);
  }

  const networkManager = new NetworkManager(`ws://${window.location.hostname}:3000`, world, playerEntity, movementSystemControls, chunkManager);
networkManager.connect();

  const MAX_RAYCAST_DISTANCE = 100;

function updateCenterScreenVoxelHighlight() {
  if (!gameCamera || !chunkManager || !voxelHighlighter) return;
    if (!showBlockHighlighter) { voxelHighlighter.update(null); return; }
  const pickRay = getCenterScreenRay(gameCamera);
  const result = raycastVoxel(pickRay.origin, pickRay.direction, chunkManager, MAX_RAYCAST_DISTANCE);
    voxelHighlighter.update(result ? result.position : null);
  }

  function handleBlockInteraction(event: MouseEvent) {
    if (!isPointerLockedToCanvas) return;
    // Simplified cooldown check
  const now = Date.now();
    if (now - lastBlockActionTime < BLOCK_ACTION_COOLDOWN && !movementSystemControls.isFlying()) {
      if (showCrosshair && crosshairElement) crosshairElement.style.backgroundColor = 'grey';
    return;
  }
    lastBlockActionTime = now; // Update time after check
    if (crosshairElement) crosshairElement.style.backgroundColor = 'red';


  const centerRay = getCenterScreenRay(gameCamera);
    const hit = raycastVoxel(centerRay.origin, centerRay.direction, chunkManager, 10);
  if (hit && hit.voxel && hit.normal) {
      if (event.button === 0) { // Left click
      networkManager.sendMineCommand(hit.voxel.x, hit.voxel.y, hit.voxel.z);
      } else if (event.button === 2) { // Right click
        const placePosition = new THREE.Vector3().copy(hit.voxel).add(hit.normal);
      networkManager.sendPlaceCommand(placePosition.x, placePosition.y, placePosition.z, DEFAULT_PLACE_BLOCK_ID);
      }
    }
  }
  document.addEventListener('mousedown', handleBlockInteraction); // Simplified from documentMousedownHandler

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  stats?.begin();
  const delta = clock.getDelta();

  inputLookSystemInstance(world);
    playerMovementSystem(world, delta); // Pass delta to playerMovementSystem
  cameraSystemManager.system(world);
  transformSystem(world);

  const playerWorldX = Transform.position.x[playerEntity];
  const playerWorldZ = Transform.position.z[playerEntity];
  chunkManager.update(playerWorldX, playerWorldZ, scene, true);
  updateCenterScreenVoxelHighlight();

  if (showCollisionBoxes) {
    const playerPosVec3 = new THREE.Vector3(playerWorldX, Transform.position.y[playerEntity], playerWorldZ);
    updateCollisionVisualization(playerPosVec3, gameCamera);
  }
    
  renderer.render(scene, gameCamera);
  stats?.end();
}

  // Start the animation loop
animate();

  // Hide loader now that the main setup is done and animate loop is kicked off
  if (loadingOverlay) {
    loadingOverlay.style.display = 'none';
    console.log('[Main] Loader hidden after animate() call.');
  }
  if (document.body) { // Ensure body exists
     document.body.classList.remove('loading-active'); // Remove if it was added
  }


  // Cleanup logic
window.addEventListener('unload', () => {
  networkManager.disconnect();
  chunkManager.dispose();
  noiseManager.dispose();
  mesherManager.dispose();
  document.removeEventListener('keydown', mainKeyDownHandler);
    // document.removeEventListener('keyup', mainKeyUpHandler); // Already removed
  if (adminMenu.parentNode) document.body.removeChild(adminMenu);
    if (crosshairElement.parentNode) document.body.removeChild(crosshairElement);
  cameraSystemManager.cleanup();
    if ((inputLookSystemInstance as any).cleanup) (inputLookSystemInstance as any).cleanup();
  movementSystemControls.cleanup();
    document.removeEventListener('mousedown', handleBlockInteraction);
    document.removeEventListener('pointerlockchange', onPointerLockChange, false);
    document.removeEventListener('pointerlockerror', onPointerLockError, false);
    if (stats && stats.dom.parentNode) document.body.removeChild(stats.dom);
  });

} // --- END OF async function main() ---


// Call main to start the application - ENSURE THIS IS THE LAST THING
main().catch(err => {
  console.error('[Main] Fatal boot error:', err);
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.innerHTML = `<div>Error during startup. Check console. <pre>${err}</pre></div>`;
    loadingOverlay.style.display = 'flex'; // Ensure it's visible
    loadingOverlay.style.color = 'red';
    loadingOverlay.style.backgroundColor = 'black';
  }
}); 